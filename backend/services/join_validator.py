"""
Pre-query join validation.

Before the AI generates SQL this module answers two questions:

1. Can every selected table be reached from every other one through the
   configured relationships?  If not, SQL generation is blocked and a
   human-readable clarification is returned instead.

2. What are the explicit JOIN … ON … clauses the AI must use?  These are
   injected into the prompt so the model never has to guess column names.

Algorithm
─────────
Build an undirected graph where nodes are table names and edges are
relationships.  Run a BFS component search.  If the graph has more than one
component the tables cannot all be joined and the disconnected groups are
reported back to the user.
"""

from __future__ import annotations

from collections import defaultdict, deque


# ── Graph helpers ─────────────────────────────────────────────────────────────

def _build_graph(
    table_names: frozenset[str],
    relationships: list[dict],
) -> dict[str, set[str]]:
    """Undirected adjacency: table → set of tables it is directly related to."""
    graph: dict[str, set[str]] = defaultdict(set)
    for r in relationships:
        lt = r.get("left_table", "")
        rt = r.get("right_table", "")
        if lt in table_names and rt in table_names and lt != rt:
            graph[lt].add(rt)
            graph[rt].add(lt)
    return graph


def _connected_components(
    table_names: frozenset[str],
    graph: dict[str, set[str]],
) -> list[frozenset[str]]:
    """BFS connected-component finder.  Returns one frozenset per component."""
    visited: set[str] = set()
    components: list[frozenset[str]] = []

    for start in sorted(table_names):           # sorted → deterministic output
        if start in visited:
            continue
        component: set[str] = set()
        queue: deque[str] = deque([start])
        while queue:
            node = queue.popleft()
            if node in visited:
                continue
            visited.add(node)
            component.add(node)
            queue.extend(graph.get(node, set()) - visited)
        components.append(frozenset(component))

    return components


# ── Public API ────────────────────────────────────────────────────────────────

def validate_joins(
    table_names: set[str] | frozenset[str],
    relationships: list[dict],
) -> tuple[bool, str]:
    """
    Check that every selected table can reach every other one via relationships.

    Parameters
    ----------
    table_names
        Names of all tables the current query will touch.
    relationships
        List of dicts — each must contain ``left_table``, ``left_column``,
        ``right_table``, ``right_column``.

    Returns
    -------
    ``(True, "")``
        All tables are connected — SQL generation may proceed.
    ``(False, clarification)``
        One or more tables are disconnected.  ``clarification`` is a
        human-readable message that can be returned directly to the user.

    Examples
    --------
    Single table — always valid::

        validate_joins({"customers"}, [])  →  (True, "")

    Two connected tables::

        validate_joins(
            {"customers", "orders"},
            [{"left_table": "customers", "left_column": "id",
              "right_table": "orders", "right_column": "customer_id"}],
        )  →  (True, "")

    Disconnected tables::

        validate_joins({"customers", "products"}, [])
        →  (False, "Cannot generate a JOIN query …")
    """
    names = frozenset(table_names)

    # Single table: no join is needed, always valid.
    if len(names) <= 1:
        return True, ""

    graph = _build_graph(names, relationships)
    parts = _connected_components(names, graph)

    if len(parts) == 1:
        return True, ""

    # ── Build a clear, actionable error message ───────────────────────────────
    sorted_parts = sorted([sorted(p) for p in parts], key=lambda g: (len(g), g))

    lines: list[str] = [
        "I need more information to join these tables — "
        "no relationship has been configured between them.\n"
    ]

    if len(sorted_parts) == 2:
        a, b = sorted_parts
        lines.append(
            f"  '{', '.join(a)}' and '{', '.join(b)}' are not linked."
        )
    else:
        for group in sorted_parts:
            others = sorted(names - set(group))
            lines.append(
                f"  '{', '.join(group)}' has no path to '{', '.join(others)}'."
            )

    lines.append(
        "\nTo fix this:\n"
        "  • Open the Relationships panel and add the missing join condition, or\n"
        "  • Deselect the unrelated table before asking your question."
    )

    return False, "\n".join(lines)


def required_joins(
    table_names: set[str] | frozenset[str],
    relationships: list[dict],
) -> list[str]:
    """
    Return explicit ``A JOIN B ON A.x = B.y`` strings for all relationships
    that connect tables in *table_names*.

    The strings are injected into the AI prompt so the model uses the correct
    column names and never has to guess.

    Duplicate and self-referential relationships are silently skipped.

    Examples
    --------
    ::

        required_joins(
            {"customers", "orders"},
            [{"left_table": "customers", "left_column": "id",
              "right_table": "orders",   "right_column": "customer_id"}],
        )
        →  ["customers JOIN orders ON customers.id = orders.customer_id"]
    """
    names = frozenset(table_names)
    seen: set[frozenset] = set()
    joins: list[str] = []

    for r in relationships:
        lt = r.get("left_table", "")
        lc = r.get("left_column", "")
        rt = r.get("right_table", "")
        rc = r.get("right_column", "")

        if not (lt and lc and rt and rc):
            continue
        if lt not in names or rt not in names:
            continue
        if lt == rt:
            continue

        # Deduplicate bidirectional duplicates
        key: frozenset = frozenset([(lt, lc), (rt, rc)])
        if key in seen:
            continue
        seen.add(key)

        joins.append(f"{lt} JOIN {rt} ON {lt}.{lc} = {rt}.{rc}")

    return joins
