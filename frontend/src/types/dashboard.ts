export interface ChartSeries {
  dataKey: string;
  name: string;
  fill?: string;
  stroke?: string;
}

export interface ChartConfig {
  type: 'BarChart' | 'LineChart' | 'PieChart' | 'ScatterChart' | 'AreaChart';
  title: string;
  description: string;
  xAxisKey: string;
  yAxisKey?: string;
  data: Array<Record<string, unknown>>;
  series: ChartSeries[];
}

export interface DrillDownRow {
  city: string;
  restaurant: string;
  dish: string;
  price: number;
  rating: number;
  ratingCount: number;
}

export interface AvailableFilters {
  states: string[];
  cities: string[];
  categories: string[];
}

export interface Anomaly {
  anomaly: string;
  value: string | number;
  metric: string;
  description: string;
}

export interface ExportLink {
  label: string;
  url: string;
}

export interface AnalysisResponse {
  sessionId?: string;
  summary: string;
  detailedReport?: string;
  availableFilters?: AvailableFilters;
  drillDownData?: DrillDownRow[];
  charts: ChartConfig[];
  anomalies: Anomaly[];
  recommendations: string[];
  fileLocation?: string;
  exportLinks?: ExportLink[];
}