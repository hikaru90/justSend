import type { DesignLibraryComponent } from './library';

export const LIBRARY_KEY = Symbol('email-builder-library');

export class EmailBuilderLibrary {
	components = $state<DesignLibraryComponent[]>([]);
	previewOverrides = $state<Record<string, string>>({});
	colors = $state<string[]>([]);
}
