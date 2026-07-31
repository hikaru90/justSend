export type DesignLibraryComponent = {
	id: string;
	name: string;
	kind: string;
	role: string;
	description: string | null;
	starterKey: string | null;
	html: string;
	props: string[];
};
