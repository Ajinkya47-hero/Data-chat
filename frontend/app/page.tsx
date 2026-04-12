"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getWorkspace } from "@/lib/api";
import {
  Upload,
  Brain,
  MessageSquare,
  BarChart3,
  Zap,
  GitMerge,
  Search,
  TrendingDown,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Database,
  Sparkles,
  ChevronRight,
} from "lucide-react";

// ─── Shared smart-navigate helper ────────────────────────────────────────────

async function navigateToApp(router: ReturnType<typeof useRouter>) {
  const workspaceId = typeof window !== "undefined" ? localStorage.getItem("workspace_id") : null;
  if (workspaceId) {
    try {
      const res = await getWorkspace(workspaceId);
      const analyses: any[] = res.data.analyses ?? [];
      if (analyses.some((a) => a.dataset_count > 0)) {
        router.push("/dashboard");
        return;
      }
    } catch {
      localStorage.removeItem("workspace_id");
    }
  }
  router.push("/upload");
}

// ─── Navbar ──────────────────────────────────────────────────────────────────

function Navbar() {
  const router = useRouter();
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 bg-white/80 backdrop-blur-xl border-b border-neutral-100">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
          <Database className="w-4 h-4 text-white" />
        </div>
        <span className="text-lg font-bold text-neutral-900">DataChat</span>
      </div>
      <div className="hidden md:flex items-center gap-8 text-sm font-medium text-neutral-600">
        <a href="#how-it-works" className="hover:text-primary transition-colors">How it works</a>
        <a href="#features" className="hover:text-primary transition-colors">Features</a>
        <a href="#use-cases" className="hover:text-primary transition-colors">Use Cases</a>
        <a href="#compare" className="hover:text-primary transition-colors">Compare</a>
      </div>
      <button
        onClick={() => navigateToApp(router)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
      >
        Get Started <ChevronRight className="w-4 h-4" />
      </button>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function HeroVisual() {
  const datasets = [
    { name: "sales_2024.csv", rows: "12,450 rows", color: "from-blue-500 to-blue-600", delay: "0ms" },
    { name: "customers.csv", rows: "8,200 rows", color: "from-violet-500 to-violet-600", delay: "100ms" },
    { name: "products.csv", rows: "3,800 rows", color: "from-emerald-500 to-emerald-600", delay: "200ms" },
  ];

  return (
    <div className="relative w-full max-w-2xl mx-auto mt-14 select-none">
      {/* Dataset cards flowing in */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-center mb-6">
        {datasets.map((d) => (
          <div
            key={d.name}
            className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-neutral-200 shadow-sm w-full md:w-auto"
          >
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${d.color} flex items-center justify-center flex-shrink-0`}>
              <Database className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-800">{d.name}</p>
              <p className="text-xs text-neutral-500">{d.rows}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Arrow + AI brain */}
      <div className="flex flex-col items-center gap-2 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-primary/40" />
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-primary/40" />
        </div>
        <p className="text-xs font-medium text-primary">AI detects relationships & joins data</p>
      </div>

      {/* Output insight card */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-lg p-5 w-full">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-xs text-neutral-500 mb-1">You asked</p>
            <p className="text-sm font-semibold text-neutral-800">"Which customers generated the most revenue last quarter?"</p>
          </div>
        </div>
        <div className="pl-11">
          <p className="text-xs text-neutral-600 mb-3">
            <span className="font-semibold text-emerald-600">Top 3 customers</span> account for <span className="font-semibold">42% of total revenue</span> ($1.2M). Customer <span className="font-semibold">Acme Corp</span> leads with $487K — driven by 3 high-value product lines.
          </p>
          <div className="flex gap-2">
            {["Acme Corp — $487K", "TechPlus — $391K", "BuildCo — $322K"].map((item, i) => (
              <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-md">{item}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const router = useRouter();
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-24 pb-20 px-6 overflow-hidden">
      {/* Background gradients */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-500/8 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] rounded-full bg-violet-500/8 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0)_0%,_rgba(249,250,251,0.8)_100%)]" />
      </div>

      <div className="text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-medium text-primary">AI-Powered Multi-Dataset Analysis</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold text-neutral-900 tracking-tight leading-[1.05] mb-6">
          Turn scattered{" "}
          <span className="text-gradient">spreadsheets</span>{" "}
          into business insights
        </h1>

        <p className="text-xl md:text-2xl text-neutral-500 max-w-2xl mx-auto leading-relaxed mb-10">
          Upload multiple CSVs, let AI connect your data automatically, then simply ask questions — and get instant insights, charts, and explanations.
        </p>

        <div className="flex items-center justify-center">
          <button
            onClick={() => navigateToApp(router)}
            className="flex items-center gap-2 px-8 py-4 bg-primary text-white text-base font-semibold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5"
          >
            <Upload className="w-5 h-5" />
            Upload Your Data
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-4 text-sm text-neutral-400">No credit card required · Works with any CSV file</p>
      </div>

      <HeroVisual />
    </section>
  );
}

// ─── Problem ──────────────────────────────────────────────────────────────────

function Problem() {
  const pains = [
    {
      icon: "📊",
      title: "Data is everywhere, insights are nowhere",
      desc: "Sales in one sheet, customers in another, products in a third. Getting answers means hours of manual work.",
    },
    {
      icon: "🔗",
      title: "Manual joins break your flow",
      desc: "VLOOKUP, INDEX-MATCH, SQL joins — every cross-dataset question turns into an engineering project.",
    },
    {
      icon: "⏳",
      title: "Dashboards take days to build",
      desc: "By the time your BI report is ready, the business question has already changed.",
    },
  ];

  return (
    <section className="py-24 px-6 bg-neutral-950">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">The Problem</p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-4">
            Your data is everywhere.<br />Your answers aren't.
          </h2>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            Most businesses sit on a goldmine of data — but getting insights requires technical skills, hours of work, and tools that don't talk to each other.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {pains.map((p) => (
            <div key={p.title} className="p-8 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors">
              <div className="text-4xl mb-4">{p.icon}</div>
              <h3 className="text-lg font-bold text-white mb-2">{p.title}</h3>
              <p className="text-neutral-400 text-sm leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      number: "01",
      icon: <Upload className="w-6 h-6" />,
      title: "Upload multiple datasets",
      desc: "Drop in any number of CSV files — sales data, customer lists, product catalogs, whatever you have.",
      color: "from-blue-500 to-blue-600",
    },
    {
      number: "02",
      icon: <GitMerge className="w-6 h-6" />,
      title: "AI connects them automatically",
      desc: "Our AI detects relationships between your datasets — no manual joins, no SQL, no configuration needed.",
      color: "from-violet-500 to-violet-600",
    },
    {
      number: "03",
      icon: <MessageSquare className="w-6 h-6" />,
      title: "Ask in plain English",
      desc: "Type any business question naturally. \"Why did revenue drop?\" or \"Who are my best customers?\"",
      color: "from-emerald-500 to-emerald-600",
    },
    {
      number: "04",
      icon: <BarChart3 className="w-6 h-6" />,
      title: "Get insights + charts instantly",
      desc: "Receive clear answers, visualizations, and root-cause explanations — all in seconds.",
      color: "from-orange-500 to-orange-600",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">How It Works</p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-neutral-900 leading-tight mb-4">
            From raw data to answers<br />in four steps
          </h2>
          <p className="text-lg text-neutral-500 max-w-xl mx-auto">
            No data engineering. No dashboards to build. Just upload, ask, and understand.
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-6 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-10 left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-blue-200 via-violet-200 to-orange-200" />

          {steps.map((step, i) => (
            <div key={step.number} className="relative flex flex-col items-center text-center">
              <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center text-white shadow-lg mb-6 relative z-10`}>
                {step.icon}
              </div>
              <span className="text-xs font-bold text-neutral-400 tracking-widest mb-2">{step.number}</span>
              <h3 className="text-base font-bold text-neutral-900 mb-2">{step.title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────

function Features() {
  const features = [
    {
      icon: <Database className="w-6 h-6" />,
      color: "bg-blue-500/10 text-blue-600",
      title: "Multi-Dataset Understanding",
      desc: "Analyze relationships across all your uploaded files simultaneously — not just one at a time.",
    },
    {
      icon: <GitMerge className="w-6 h-6" />,
      color: "bg-violet-500/10 text-violet-600",
      title: "Automatic Relationship Detection",
      desc: "AI identifies how your datasets connect — customer IDs, product codes, date keys — without you doing anything.",
    },
    {
      icon: <Brain className="w-6 h-6" />,
      color: "bg-emerald-500/10 text-emerald-600",
      title: "AI-Generated SQL Analysis",
      desc: "Complex queries are written and executed automatically. You ask in English, we run the SQL.",
    },
    {
      icon: <Search className="w-6 h-6" />,
      color: "bg-orange-500/10 text-orange-600",
      title: "\"Why\" Root Cause Analysis",
      desc: "Don't just see what happened — understand why. AI drills into your data to explain anomalies and trends.",
    },
    {
      icon: <Sparkles className="w-6 h-6" />,
      color: "bg-pink-500/10 text-pink-600",
      title: "Auto Insights",
      desc: "AI proactively surfaces patterns, outliers, and opportunities you didn't even think to ask about.",
    },
  ];

  return (
    <section id="features" className="py-24 px-6 bg-neutral-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Features</p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-neutral-900 leading-tight mb-4">
            Built different.<br />Designed for answers.
          </h2>
          <p className="text-lg text-neutral-500 max-w-xl mx-auto">
            Every feature is designed to get you from raw data to business decisions — faster than anything else.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`p-8 rounded-2xl bg-white border border-neutral-200 hover:border-primary/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all hover:-translate-y-1 ${i === 4 ? "md:col-start-2" : ""}`}
            >
              <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-5`}>
                {f.icon}
              </div>
              <h3 className="text-lg font-bold text-neutral-900 mb-2">{f.title}</h3>
              <p className="text-neutral-500 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Use Cases ────────────────────────────────────────────────────────────────

function UseCases() {
  const cases = [
    {
      query: "Which customers generate the most revenue?",
      icon: <TrendingDown className="w-4 h-4 rotate-180" />,
      tagColor: "bg-emerald-100 text-emerald-700",
      tag: "Revenue",
      answer: "Top 20% of customers drive 78% of revenue. Acme Corp leads with $487K, followed by TechPlus ($391K). These 3 accounts should be your priority retention targets.",
      chips: ["Cross-dataset join", "Customer + Sales CSV"],
    },
    {
      query: "Why did sales drop last month?",
      icon: <TrendingDown className="w-4 h-4" />,
      tagColor: "bg-red-100 text-red-700",
      tag: "Root Cause",
      answer: "Sales dropped 23% due to 2 factors: Product line B had a stockout for 9 days (−$84K impact), and the Southeast region underperformed by 31% vs prior month.",
      chips: ["Why analysis", "Sales + Products CSV"],
    },
    {
      query: "Which products have the most repeat buyers?",
      icon: <RefreshCw className="w-4 h-4" />,
      tagColor: "bg-blue-100 text-blue-700",
      tag: "Retention",
      answer: "Pro Plan subscription (68% repeat rate) and Enterprise Bundle (54%) have the highest loyalty. Customers who buy both have 3.2x lifetime value vs single-product buyers.",
      chips: ["Multi-dataset", "3 CSVs analyzed"],
    },
  ];

  return (
    <section id="use-cases" className="py-24 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Use Cases</p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-neutral-900 leading-tight mb-4">
            Questions your team<br />asks every day
          </h2>
          <p className="text-lg text-neutral-500 max-w-xl mx-auto">
            DataChat answers the business questions that used to take hours — in seconds.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {cases.map((c) => (
            <div key={c.query} className="rounded-2xl border border-neutral-200 overflow-hidden hover:shadow-lg transition-all hover:-translate-y-1">
              {/* Query */}
              <div className="p-5 bg-neutral-50 border-b border-neutral-200">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center flex-shrink-0 mt-0.5 text-neutral-600">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <p className="text-sm font-semibold text-neutral-800 leading-snug">"{c.query}"</p>
                </div>
              </div>

              {/* Answer */}
              <div className="p-5 bg-white">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <p className="text-sm text-neutral-600 leading-relaxed">{c.answer}</p>
                </div>
                <div className="flex flex-wrap gap-2 pl-11">
                  <span className={`px-2 py-1 rounded-md text-xs font-medium ${c.tagColor}`}>{c.tag}</span>
                  {c.chips.map((chip) => (
                    <span key={chip} className="px-2 py-1 rounded-md text-xs font-medium bg-neutral-100 text-neutral-600">{chip}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Comparison ───────────────────────────────────────────────────────────────

function Comparison() {
  const rows = [
    { feature: "Analyze multiple datasets together", excel: false, bi: "partial", us: true },
    { feature: "Auto-detect relationships between files", excel: false, bi: false, us: true },
    { feature: "Ask questions in natural language", excel: false, bi: false, us: true },
    { feature: "Root cause / \"Why\" analysis", excel: false, bi: false, us: true },
    { feature: "Proactive AI-generated insights", excel: false, bi: false, us: true },
    { feature: "No SQL or formulas required", excel: false, bi: "partial", us: true },
    { feature: "Works in minutes (no setup)", excel: true, bi: false, us: true },
  ];

  const Cell = ({ value }: { value: boolean | "partial" }) => {
    if (value === true) return <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />;
    if (value === "partial") return <div className="w-5 h-5 rounded-full bg-yellow-200 border-2 border-yellow-400 mx-auto" />;
    return <XCircle className="w-5 h-5 text-neutral-300 mx-auto" />;
  };

  return (
    <section id="compare" className="py-24 px-6 bg-neutral-950">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Why DataChat</p>
          <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight mb-4">
            Not just another<br />analytics tool
          </h2>
          <p className="text-lg text-neutral-400 max-w-xl mx-auto">
            Excel and BI tools were built for analysts. DataChat is built for everyone who needs answers.
          </p>
        </div>

        <div className="rounded-2xl overflow-hidden border border-white/10">
          {/* Header */}
          <div className="grid grid-cols-4 bg-white/5 border-b border-white/10">
            <div className="p-5 col-span-1" />
            {[
              { label: "Excel", sub: "Manual formulas" },
              { label: "BI Tools", sub: "Requires setup" },
              { label: "DataChat", sub: "AI-powered", highlight: true },
            ].map((h) => (
              <div key={h.label} className={`p-5 text-center ${h.highlight ? "bg-primary/20" : ""}`}>
                <p className={`font-bold text-sm ${h.highlight ? "text-primary" : "text-white"}`}>{h.label}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{h.sub}</p>
              </div>
            ))}
          </div>

          {/* Rows */}
          {rows.map((row, i) => (
            <div key={row.feature} className={`grid grid-cols-4 border-b border-white/5 last:border-0 ${i % 2 === 0 ? "bg-white/[0.02]" : ""}`}>
              <div className="p-4 col-span-1">
                <p className="text-sm text-neutral-300">{row.feature}</p>
              </div>
              <div className="p-4 flex items-center justify-center">
                <Cell value={row.excel} />
              </div>
              <div className="p-4 flex items-center justify-center">
                <Cell value={row.bi} />
              </div>
              <div className="p-4 flex items-center justify-center bg-primary/5">
                <Cell value={row.us} />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-6 justify-center mt-6 text-xs text-neutral-500">
          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Fully supported</div>
          <div className="flex items-center gap-2"><div className="w-4 h-4 rounded-full bg-yellow-200 border-2 border-yellow-400" /> Partial / complex</div>
          <div className="flex items-center gap-2"><XCircle className="w-4 h-4 text-neutral-600" /> Not supported</div>
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCTA() {
  const router = useRouter();
  return (
    <section className="py-32 px-6 relative overflow-hidden bg-white">
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      <div className="max-w-3xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100 mb-8">
          <Zap className="w-3.5 h-3.5 text-primary" />
          <span className="text-sm font-medium text-primary">Ready in 30 seconds</span>
        </div>

        <h2 className="text-5xl md:text-6xl font-extrabold text-neutral-900 tracking-tight leading-[1.05] mb-6">
          Stop building dashboards.<br />
          <span className="text-gradient">Start asking questions.</span>
        </h2>

        <p className="text-xl text-neutral-500 mb-12 max-w-xl mx-auto">
          Join businesses already using DataChat to turn their scattered spreadsheets into instant, AI-powered answers.
        </p>

        <div className="flex items-center justify-center">
          <button
            onClick={() => navigateToApp(router)}
            className="flex items-center gap-2 px-8 py-4 bg-primary text-white text-base font-semibold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5"
          >
            <Upload className="w-5 h-5" />
            Upload Your Data
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-6 text-sm text-neutral-400">
          No credit card · No setup · Works with any CSV file
        </p>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="py-10 px-6 border-t border-neutral-100 bg-white">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
            <Database className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-bold text-neutral-900">DataChat</span>
        </div>
        <p className="text-sm text-neutral-400">AI-powered multi-dataset analytics · Ask questions, get answers.</p>
        <Link href="/dashboard" className="text-sm font-medium text-primary hover:text-blue-700 transition-colors">
          Launch App →
        </Link>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  // No auto-redirect — let users view the landing page freely.

  return (
    <div className="min-h-screen">
      <Navbar />
      <Hero />
      <Problem />
      <HowItWorks />
      <Features />
      <UseCases />
      <Comparison />
      <FinalCTA />
      <Footer />
    </div>
  );
}
