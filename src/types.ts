// types.ts
export interface AnalystState {
    // 1. Inputs
    businessQuestion: string;
    filePath: string;
    datasetSchema: string;
    
    // 2. Planning & Metrics
    identifiedMetrics: string[];
    comparisonPeriods: string[];
    
    // 3. Execution
    generatedSQL: string;
    sqlError: string | null;
    queryResults: any[];
    
    // 4. Diagnostics & Analytics
    anomaliesDetected: string[];
    segmentedData: any;
    possibleCauses: string[];
    
    // 5. Synthesis
    executiveSummary: string;
    chartConfigs: any[]; // e.g., Recharts JSON configs
    recommendations: string[];
}