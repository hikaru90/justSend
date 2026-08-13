import type { DesignLibraryAsset, DesignLibraryComponent } from './library';

export const LIBRARY_KEY = Symbol('email-builder-library');

export class EmailBuilderLibrary {
	components = $state<DesignLibraryComponent[]>([]);
	previewOverrides = $state<Record<string, string>>({});
	colors = $state<string[]>([]);
	assets = $state<DesignLibraryAsset[]>([]);
	onUploadAsset = $state<
		((file: File) => Promise<{ id: string; name: string; kind: string } | null>) | null
	>(null);
}
