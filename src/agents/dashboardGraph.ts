import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { modelRouter } from "../gateway/modelRouter";

const MAX_ATTEMPTS = 3;
// Rows sent to the browser for filtering. Keep in sync with DRILL_LIMIT in Dashboard.tsx
const DRILL_LIMIT = 5000;
const ALLOWED_TYPES = ["BarChart", "LineChart", "AreaChart", "PieChart", "ScatterChart"];
const AGGS = ["SUM", "AVG", "COUNT", "MIN", "MAX", "COUNT_DISTINCT"];

// 1. Shared Graph State Annotation
export const DashboardState = Annotation.Root({
  userObjective: Annotation<string>(),
  rawSchema: Annotation<string>(),
  tableReference: Annotation<string>(),

  // Inter-agent artifact handoffs
  dataProfile: Annotation<any>(),
  strategyPlan: Annotation<any>(),
  finalBlueprint: Annotation<any>(),

  attempts: Annotation<number>({
    reducer: (x, y) => y,
    default: () => 0,
  }),
  validationError: Annotation<string | null>({
    reducer: (x, y) => y,
    default: () => null,
  }),
});

// Helper: tolerant JSON parser (handles code fences and text around the object)
const parseJson = (text: string) => {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
};

const textOf = (response: any): string =>
  Array.isArray(response.content)
    ? response.content.map((c: any) => c.text ?? "").join("")
    : String(response.content ?? "");

// -------------------------------------------------------------
// NODE 1: The Schema Profiler Agent
// -------------------------------------------------------------
const profilerNode = async (state: typeof DashboardState.State) => {
  const prompt = new SystemMessage(`
  You are an expert Data Profiler. Analyze the DuckDB schema and categorize the dataset fields.
  Return ONLY a valid JSON object matching this structure:
  {
    "dimensions": ["categorical_column_names"],
    "metrics": ["numeric_column_names"],
    "timeColumns": ["date_or_timestamp_column_names"]
  }
  Use the EXACT column names from the schema.

  SCHEMA: ${state.rawSchema}
  `);

  const response: any = await modelRouter.routeExecution([
    prompt,
    new HumanMessage("Profile the schema now."),
  ]);

  const profile = parseJson(textOf(response)) || { dimensions: [], metrics: [], timeColumns: [] };
  return { dataProfile: profile };
};

// -------------------------------------------------------------
// NODE 2: The BI Strategist Agent
// -------------------------------------------------------------
const strategistNode = async (state: typeof DashboardState.State) => {
  const prompt = new SystemMessage(`
  You are a BI Executive Strategist. Design a high-level dashboard plan for the user objective without writing SQL.
  Plan 4 to 6 charts. Prefer dimensions with a modest number of distinct values so the charts stay readable.

  User Objective: "${state.userObjective}"
  Data Profile: ${JSON.stringify(state.dataProfile)}

  Return ONLY a JSON object:
  {
    "summary": "Key executive findings focus in 2 sentences.",
    "detailedReport": "## Strategic Highlights\\n- Focus 1\\n- Focus 2",
    "chartConcepts": [
      {
        "type": "BarChart",
        "title": "Distribution Title",
        "description": "What this chart reveals",
        "dimension": "exact_column_name",
        "metric": "exact_column_name or null for row counts",
        "aggregation": "SUM | AVG | COUNT | MIN | MAX | COUNT_DISTINCT"
      }
    ],
    "recommendations": ["Actionable recommendation 1"]
  }
  `);

  const response: any = await modelRouter.routeExecution([
    prompt,
    new HumanMessage("Generate the BI Strategy Plan."),
  ]);

  const strategy = parseJson(textOf(response)) || {
    summary: "Analysis",
    detailedReport: "",
    chartConcepts: [],
    recommendations: [],
  };
  return { strategyPlan: strategy };
};

// -------------------------------------------------------------
// NODE 3: The SQL Engineer Agent
// -------------------------------------------------------------
const sqlEngineerNode = async (state: typeof DashboardState.State) => {
  const feedback = state.validationError
    ? `YOUR PREVIOUS OUTPUT WAS REJECTED. FIX THESE PROBLEMS: ${state.validationError}`
    : "First attempt.";

  const prompt = new SystemMessage(`
  You are a DuckDB SQL Engineer. Convert the Strategy Plan into executable DuckDB SQL for each chart.

  Table Reference: ${state.tableReference}
  Schema: ${state.rawSchema}
  Chart concepts: ${JSON.stringify(state.strategyPlan?.chartConcepts || [])}
  ${feedback}

  CRITICAL INSTRUCTIONS:
  1. Return ONLY one valid JSON object, no prose.
  2. Use double quotes for column names with spaces. Use single quotes for text literals.
  3. Every chart MUST include a "spec" object. The dashboard uses it to rebuild the chart in the browser when the
     viewer applies filters, so it must describe EXACTLY what the SQL computes:
     - spec.dimension: the EXACT raw column name that is grouped on (from the schema, not an alias).
     - spec.measures: one entry per series. "dataKey" must be identical to the series dataKey AND to the SQL alias.
       "column" is the EXACT raw column being aggregated (use null for row counts, with agg COUNT).
       "agg" is one of SUM, AVG, COUNT, MIN, MAX, COUNT_DISTINCT and must match the SQL aggregate.
     - spec.sort: "value_desc", "value_asc" or "x_asc" (use "x_asc" for time series). spec.limit: the LIMIT used in the SQL.
     - Time charts: set spec.bucket to "day", "month" or "year" and group in SQL with
       strftime(CAST("col" AS DATE), '%Y-%m') for month, '%Y' for year, '%Y-%m-%d' for day.
       Otherwise set spec.bucket to null.
     - ScatterChart: spec is {"xColumn": "raw_col", "yColumn": "raw_col"}; the SQL selects those two columns
       (LIMIT 500), xAxisKey is the x alias and yAxisKey is the y alias.
  4. xAxisKey must equal the SQL alias of the dimension. Do NOT add WHERE clauses unless the objective asks for one.
  5. Allowed chart types: ${ALLOWED_TYPES.join(", ")}.

  JSON Output Schema:
  {
    "filterQueries": [],
    "anomaliesQuery": "SELECT * FROM ${state.tableReference} LIMIT 5",
    "charts": [
      {
        "type": "BarChart",
        "title": "Title",
        "description": "Desc",
        "xAxisKey": "region",
        "sql": "SELECT \\"Region\\" AS region, SUM(\\"Sales\\") AS total_sales FROM ${state.tableReference} GROUP BY \\"Region\\" ORDER BY total_sales DESC LIMIT 10",
        "series": [{"dataKey": "total_sales", "name": "Total Sales", "fill": "#22d3ee"}],
        "spec": {
          "dimension": "Region",
          "bucket": null,
          "measures": [{"dataKey": "total_sales", "column": "Sales", "agg": "SUM"}],
          "sort": "value_desc",
          "limit": 10
        }
      }
    ]
  }
  `);

  const response: any = await modelRouter.routeExecution([
    prompt,
    new HumanMessage("Generate the SQL Blueprint now."),
  ]);

  const blueprint = parseJson(textOf(response));

  if (blueprint && typeof blueprint === "object") {
    // Text content comes from the strategist and is merged here, so the model never has to echo it
    // (echoing quotes and newlines inside JSON was a common source of broken output).
    blueprint.summary = state.strategyPlan?.summary ?? "";
    blueprint.detailedReport = state.strategyPlan?.detailedReport ?? "";
    blueprint.recommendations = state.strategyPlan?.recommendations ?? [];
    blueprint.filterQueries = Array.isArray(blueprint.filterQueries) ? blueprint.filterQueries : [];
    if (typeof blueprint.anomaliesQuery !== "string") {
      blueprint.anomaliesQuery = `SELECT * FROM ${state.tableReference} LIMIT 5`;
    }
    // The browser filters and re-aggregates these rows, so send enough of them.
    blueprint.drillDownQuery = `SELECT * FROM ${state.tableReference} LIMIT ${DRILL_LIMIT}`;
  }

  return {
    finalBlueprint: blueprint,
    attempts: state.attempts + 1,
  };
};

// -------------------------------------------------------------
// NODE 4: Validator (a real node, so it can write the error back into state for the retry)
// -------------------------------------------------------------
const hasColumn = (schemaLower: string, col: unknown) =>
  typeof col === "string" && col.length > 0 && schemaLower.includes(col.toLowerCase());

const chartIssues = (c: any, schemaLower: string): string[] => {
  const issues: string[] = [];
  if (!c || typeof c !== "object") return ["chart is not an object"];
  if (!ALLOWED_TYPES.includes(c.type)) issues.push(`type must be one of ${ALLOWED_TYPES.join(", ")}`);
  if (typeof c.sql !== "string" || !c.sql.trim()) issues.push("sql is missing");
  if (typeof c.xAxisKey !== "string" || !c.xAxisKey) issues.push("xAxisKey is missing");

  const spec = c.spec;
  if (!spec || typeof spec !== "object") {
    issues.push("spec is missing");
    return issues;
  }

  if (c.type === "ScatterChart") {
    if (!hasColumn(schemaLower, spec.xColumn)) issues.push("spec.xColumn must be an exact schema column");
    if (!hasColumn(schemaLower, spec.yColumn)) issues.push("spec.yColumn must be an exact schema column");
    return issues;
  }

  const series = Array.isArray(c.series) ? c.series : [];
  if (series.length === 0) issues.push("series is missing");
  if (!hasColumn(schemaLower, spec.dimension)) issues.push("spec.dimension must be an exact schema column");

  const measures = Array.isArray(spec.measures) ? spec.measures : [];
  if (measures.length === 0) issues.push("spec.measures is missing");
  series.forEach((s: any) => {
    if (!measures.some((m: any) => m?.dataKey === s?.dataKey)) {
      issues.push(`no spec.measures entry for series "${s?.dataKey}"`);
    }
  });
  measures.forEach((m: any) => {
    const agg = String(m?.agg || "").toUpperCase();
    if (!AGGS.includes(agg)) issues.push(`measure "${m?.dataKey}" has invalid agg`);
    const noColumn = m?.column === null || m?.column === undefined || m?.column === "*";
    if (noColumn && agg !== "COUNT") issues.push(`measure "${m?.dataKey}" needs a column unless agg is COUNT`);
    if (!noColumn && !hasColumn(schemaLower, m.column)) issues.push(`measure "${m?.dataKey}" column is not in the schema`);
  });
  return issues;
};

const validatorNode = (state: typeof DashboardState.State) => {
  const bp = state.finalBlueprint;
  const schemaLower = String(state.rawSchema || "").toLowerCase();

  if (!bp || typeof bp !== "object") {
    return { validationError: "Output was not a valid JSON object. Return one JSON object and nothing else." };
  }

  const charts: any[] = Array.isArray(bp.charts) ? bp.charts : [];
  const problems: string[] = [];
  const good: any[] = [];

  charts.forEach((c, i) => {
    const issues = chartIssues(c, schemaLower);
    if (issues.length) problems.push(`charts[${i}] "${c?.title ?? ""}": ${issues.join("; ")}`);
    else good.push(c);
  });
  if (charts.length === 0) problems.push("charts array is missing or empty");

  if (problems.length === 0) return { validationError: null };

  // Out of retries: ship whatever charts are valid rather than failing the whole dashboard
  if (state.attempts >= MAX_ATTEMPTS) {
    return {
      finalBlueprint: { ...bp, charts: good },
      validationError: good.length > 0 ? null : problems.join(" | "),
    };
  }
  return { validationError: problems.join(" | ") };
};

const route = (state: typeof DashboardState.State) =>
  state.validationError && state.attempts < MAX_ATTEMPTS ? "retry" : "done";

// -------------------------------------------------------------
// BUILD AND COMPILE THE STATE GRAPH
// -------------------------------------------------------------
const workflow = new StateGraph(DashboardState)
  .addNode("profiler", profilerNode)
  .addNode("strategist", strategistNode)
  .addNode("sql_engineer", sqlEngineerNode)
  .addNode("validator", validatorNode)

  .addEdge(START, "profiler")
  .addEdge("profiler", "strategist")
  .addEdge("strategist", "sql_engineer")
  .addEdge("sql_engineer", "validator")

  .addConditionalEdges("validator", route, {
    retry: "sql_engineer",
    done: END,
  });

export const dashboardGraph = workflow.compile();