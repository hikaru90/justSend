export type ImportSummary = {
	imported: Partial<Record<string, Record<string, number>>>;
	skipped: string[];
	warnings: string[];
};
