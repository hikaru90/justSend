export type DesignLibraryAsset = {
	id: string;
	name: string;
	kind: string;
};

export type DesignLibraryComponent = {
	id: string;
	name: string;
	kind: string;
	role: string;
	description: string | null;
	starterKey: string | null;
	html: string;
	/** Email-builder document JSON string. */
	document?: string;
	props: string[];
	parsedSlots?: import('./types').ComponentSlot[];
};
