from fastapi import APIRouter, HTTPException
from models.schemas import ChatRequest, ChatResponse, ChartSpec
from services.data_store import (
    get_dataset, get_first_dataset, load_rel_overrides, make_rel_id,
    save_chat_message, touch_workspace,
)
from services.query_engine import build_prompt, call_llm, generate_final_answer, SYSTEM_PROMPT
from services.rate_limiter import session_throttler
from services.relationship_detector import detect_relationships
from services.duckdb_exec import duckdb_exec
from services.join_validator import validate_joins, required_joins
from services.chart_builder import build_chart_spec
from services.why_analyzer import (
    is_why_question,
    build_why_prompt,
    build_synthesis_prompt,
    format_why_results,
)
from services.schema_builder import build_schema_context, filter_tables_for_query

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_relationships(workspace_id: str, analysis_id: str, datasets: dict) -> list[dict]:
    """Return merged relationships (auto-detected + user overrides) for an analysis."""
    if len(datasets) < 2:
        return []
    overrides_data = load_rel_overrides(workspace_id, analysis_id)
    overrides: dict = overrides_data.get("overrides", {})
    additions: list = overrides_data.get("additions", [])
    deletions: set = set(overrides_data.get("deletions", []))

    auto_rels = []
    for r in detect_relationships(datasets):
        rid = make_rel_id(r["left_table"], r["left_column"], r["right_table"], r["right_column"])
        if rid in deletions:
            continue
        rel = {**r, "id": rid, "source": "auto"}
        if rid in overrides:
            rel = {**rel, **overrides[rid]}
        auto_rels.append(rel)

    return auto_rels + additions


async def _handle_why_question(
    req,
    all_tables: dict,
    relationships: list[dict],
    join_hints: list[str],
    schema_ctx: str,
) -> "ChatResponse":
    """Run multi-query root-cause analysis for causal questions."""
    rels = relationships or None
    col_filter = filter_tables_for_query(all_tables, req.question, rels, req.history)
    filtered = {
        name: all_tables[name][cols]
        for name, cols in col_filter.items()
        if name in all_tables and cols
    } or all_tables
    full_schema = build_schema_context(filtered, rels, include_samples=True)

    why_messages = build_why_prompt(
        schema_ctx=full_schema,
        question=req.question,
        history=req.history,
        join_hints=join_hints or None,
    )

    try:
        why_response = await call_llm(why_messages, model=req.model)
    except Exception as e:
        error_str = str(e)
        if error_str.startswith("RATE_LIMITED:"):
            raise HTTPException(503, error_str.replace("RATE_LIMITED: ", ""))
        if _is_quota_error(error_str):
            raise HTTPException(429, f"Quota exceeded for model '{req.model}'. Please switch to another model.")
        raise HTTPException(500, f"Error calling AI: {error_str}")

    queries_meta: list[dict] = why_response.get("queries") or []
    fallback_answer: str = why_response.get("fallback_answer", "I could not perform root-cause analysis on the available data.")

    if not queries_meta:
        return ChatResponse(
            answer=fallback_answer,
            insight="",
            follow_up=[],
        )

    exec_results: list[dict] = []
    for qm in queries_meta:
        sql = qm.get("sql", "")
        if not sql:
            exec_results.append({"error": "No SQL provided"})
            continue
        try:
            result = duckdb_exec(sql=sql, tables=all_tables, relationships=relationships or None)
            exec_results.append(result)
        except (ValueError, RuntimeError) as e:
            exec_results.append({"error": str(e)})

    merged = format_why_results(queries_meta, exec_results)

    synthesis_messages = build_synthesis_prompt(
        query_results=merged,
        question=req.question,
        schema_ctx=schema_ctx,
        history=req.history,
    )

    try:
        synthesis = await call_llm(synthesis_messages, model=req.model)
    except Exception:
        synthesis = {}

    return ChatResponse(
        answer=synthesis.get("answer", fallback_answer),
        insight=synthesis.get("insight", ""),
        follow_up=synthesis.get("follow_up", []),
    )


def _is_quota_error(msg: str) -> bool:
    # Only treat as quota if the fallback chain itself was NOT attempted —
    # once the chain has run and all passes failed, surface as a generic 500.
    if "all model fallbacks exhausted" in msg.lower():
        return False
    lower = msg.lower()
    return "quota_exceeded" in lower or "quota exceeded" in lower or "resource_exhausted" in lower


def _format_result_for_llm(scalar, df_rows, series_data) -> str:
    """Format the computed result as clean readable text for the answer-pass LLM."""
    if scalar is not None:
        if isinstance(scalar, float):
            return f"Single value: {scalar:,.4f}"
        return f"Single value: {scalar}"

    if df_rows is not None and len(df_rows) > 0:
        rows = df_rows[:15]
        headers = list(rows[0].keys())
        lines = [" | ".join(headers), " | ".join(["---"] * len(headers))]
        for row in rows:
            lines.append(" | ".join(str(row.get(h, "")) for h in headers))
        suffix = f"\n(showing {len(rows)} of {len(df_rows)} rows)" if len(df_rows) > 15 else ""
        return "\n".join(lines) + suffix

    if series_data is not None:
        lines = [f"{k}: {v}" for k, v in list(series_data.items())[:15]]
        return "\n".join(lines)

    return ""


# ── Persistence helper ────────────────────────────────────────────────────────

def _persist(workspace_id: str, analysis_id: str, question: str, response: "ChatResponse"):
    """Save the Q&A pair to disk. Best-effort — never raises."""
    import time
    try:
        touch_workspace(workspace_id)
        ts = int(time.time() * 1000)
        user_msg = {"id": str(ts), "role": "user", "content": question}
        assistant_msg = {
            "id": str(ts + 1),
            "role": "assistant",
            "content": response.answer,
            "insight": response.insight or "",
            "chart": response.chart.model_dump() if response.chart else None,
            "code_used": response.code_used or "",
            "follow_up": response.follow_up or [],
        }
        save_chat_message(workspace_id, analysis_id, user_msg, assistant_msg)
    except Exception:
        pass


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("/query", response_model=ChatResponse)
async def chat_query(req: ChatRequest):
    # ── Per-session throttle ─────────────────────────────────────────────────
    is_throttled = await session_throttler.tick(req.workspace_id)

    # ── Load datasets ────────────────────────────────────────────────────────
    try:
        if req.dataset:
            primary_df = get_dataset(req.workspace_id, req.analysis_id, req.dataset)
        else:
            req.dataset, primary_df = get_first_dataset(req.workspace_id, req.analysis_id)
    except KeyError as e:
        raise HTTPException(404, str(e))

    extra_dfs: dict = {}
    for name in (req.extra_datasets or []):
        try:
            extra_dfs[name] = get_dataset(req.workspace_id, req.analysis_id, name)
        except KeyError:
            pass

    all_tables: dict = {req.dataset: primary_df, **extra_dfs}

    # ── Relationships ────────────────────────────────────────────────────────
    relationships = _get_relationships(req.workspace_id, req.analysis_id, all_tables)

    # ── Join validation (multi-table only) ───────────────────────────────────
    if len(all_tables) > 1:
        ok, clarification = validate_joins(set(all_tables.keys()), relationships)
        if not ok:
            return ChatResponse(
                answer=clarification,
                insight="Add the missing relationship in the Relationships panel, then ask again.",
                follow_up=[],
                throttled=is_throttled,
            )

    join_hints = required_joins(set(all_tables.keys()), relationships)

    # ── Compact schema context ────────────────────────────────────────────────
    _, schema_ctx = build_prompt(
        primary_df,
        req.question,
        req.history,
        extra_dfs=extra_dfs or None,
        primary_name=req.dataset,
        relationships=relationships or None,
        join_hints=None,
    )

    # ── Why / root-cause branch ──────────────────────────────────────────────
    if is_why_question(req.question):
        why_resp = await _handle_why_question(
            req, all_tables, relationships, join_hints, schema_ctx
        )
        why_resp.throttled = is_throttled
        _persist(req.workspace_id, req.analysis_id, req.question, why_resp)
        return why_resp

    # ── Build prompt (Pass 1: SQL generation) ────────────────────────────────
    prompt_messages, schema_ctx = build_prompt(
        primary_df,
        req.question,
        req.history,
        extra_dfs=extra_dfs or None,
        primary_name=req.dataset,
        relationships=relationships or None,
        join_hints=join_hints or None,
    )

    try:
        llm_response = await call_llm(prompt_messages, model=req.model)
    except Exception as e:
        error_str = str(e)
        if error_str.startswith("RATE_LIMITED:"):
            raise HTTPException(503, error_str.replace("RATE_LIMITED: ", ""))
        if _is_quota_error(error_str):
            raise HTTPException(429, f"Quota exceeded for model '{req.model}'. Please switch to another model.")
        raise HTTPException(500, f"Error calling AI: {error_str}")

    sql: str | None = llm_response.get("query") or None
    chart_type: str = llm_response.get("chart_type", "none")
    chart_title: str = llm_response.get("chart_title", "")
    fallback_answer: str = llm_response.get("fallback_answer", "I could not answer that question based on the data.")

    # ── No SQL needed ─────────────────────────────────────────────────────────
    if not sql:
        try:
            answer_response = await generate_final_answer(
                req.question, schema_ctx, "", req.model, history=req.history
            )
            no_sql_resp = ChatResponse(
                answer=answer_response.get("answer", fallback_answer),
                insight=answer_response.get("insight", ""),
                clarification=llm_response.get("clarification"),
                follow_up=answer_response.get("follow_up", []),
                throttled=is_throttled,
            )
        except Exception:
            no_sql_resp = ChatResponse(
                answer=fallback_answer,
                insight="",
                clarification=llm_response.get("clarification"),
                follow_up=[],
                throttled=is_throttled,
            )
        _persist(req.workspace_id, req.analysis_id, req.question, no_sql_resp)
        return no_sql_resp

    # ── Execute SQL via DuckDB (with one retry on syntax errors) ────────────────
    exec_result = None
    exec_error = None
    used_sql = sql

    for attempt in range(2):
        try:
            exec_result = duckdb_exec(
                sql=used_sql,
                tables=all_tables,
                relationships=relationships or None,
            )
            break  # success
        except (ValueError, RuntimeError) as e:
            exec_error = str(e)
            if attempt == 0:
                # Ask the LLM to fix its own SQL using the error message
                fix_messages = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": (
                        f"{schema_ctx}\n\n"
                        f"Question: '{req.question}'\n\n"
                        f"The following SQL query failed:\n{used_sql}\n\n"
                        f"Error: {exec_error}\n\n"
                        f"Write a corrected SQL query. Remember to double-quote column names that contain spaces or special characters."
                    )},
                ]
                try:
                    fix_resp = await call_llm(fix_messages, model=req.model)
                    fixed_sql = fix_resp.get("query")
                    if fixed_sql and fixed_sql != used_sql:
                        used_sql = fixed_sql
                        continue  # retry with fixed SQL
                except Exception:
                    pass
                break  # give up if fix failed

    if exec_result is None:
        return ChatResponse(
            answer="I couldn't process that query on your data. Could you try rephrasing your question? For example, be specific about which columns or values you're interested in.",
            insight="",
            follow_up=[
                f"What columns are available in my data?",
                f"Show me a summary of the dataset",
                f"What are the top 5 rows?",
            ],
            throttled=is_throttled,
        )

    scalar = exec_result.get("scalar")
    df_rows = exec_result.get("dataframe")
    series_data = exec_result.get("series")
    exec_warnings: list[str] = exec_result.get("warnings", [])

    if df_rows:
        def _clean_val(v):
            if isinstance(v, str):
                v = v.replace(" 00:00:00", "").replace("T00:00:00", "")
            return v
        df_rows = [
            {k: _clean_val(v) for k, v in row.items() if not str(k).startswith("Unnamed")}
            for row in df_rows
        ]

    result_data = df_rows or series_data or scalar
    result_text = _format_result_for_llm(scalar, df_rows, series_data)

    if exec_warnings:
        warning_lines = "\n".join(f"⚠ {w}" for w in exec_warnings)
        result_text = warning_lines + ("\n\n" + result_text if result_text else "")

    # ── Pass 2: generate analyst answer ──────────────────────────────────────
    answer = fallback_answer
    insight = ""
    follow_up: list[str] = []

    if result_text:
        try:
            answer_response = await generate_final_answer(
                req.question, schema_ctx, result_text, req.model, history=req.history
            )
            answer = answer_response.get("answer", fallback_answer)
            insight = answer_response.get("insight", "")
            follow_up = answer_response.get("follow_up", [])
        except Exception:
            if scalar is not None:
                formatted = f"{scalar:,.2f}" if isinstance(scalar, float) else f"{scalar:,}" if isinstance(scalar, int) else str(scalar)
                answer = f"{fallback_answer}\n\n**Result: {formatted}**"
            elif df_rows:
                rows = df_rows[:10]
                headers = list(rows[0].keys())
                lines = [" | ".join(headers), " | ".join(["---"] * len(headers))]
                lines += [" | ".join(str(r.get(h, "")) for h in headers) for r in rows]
                answer = f"{fallback_answer}\n\n" + "\n".join(lines)

    # ── Build chart ───────────────────────────────────────────────────────────
    chart_spec = None
    if chart_type != "none" and result_data is not None:
        chart_dict = build_chart_spec(
            result_data,
            chart_type,
            chart_title,
            x_col=llm_response.get("x_col"),
            y_col=llm_response.get("y_col"),
        )
        if chart_dict:
            chart_spec = ChartSpec(**chart_dict)

    final_resp = ChatResponse(
        answer=answer,
        insight=insight,
        chart=chart_spec,
        code_used=sql,
        follow_up=follow_up,
        throttled=is_throttled,
    )
    _persist(req.workspace_id, req.analysis_id, req.question, final_resp)
    return final_resp
