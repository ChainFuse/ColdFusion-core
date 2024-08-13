import { getInput } from '@actions/core';
import { find } from '@actions/tool-cache';
import { format, join, parse } from 'node:path';

export class BaseCore {
	protected os = getInput('os', { required: true, trimWhitespace: true }).toLowerCase() as 'linux' | 'windows' | 'macos';
	protected arch = getInput('arch', { required: true, trimWhitespace: true }).toLowerCase() as 'x86' | 'x64' | 'arm' | 'arm64';

	protected requestedOllamaVersion = getInput('ollama-version', { required: true, trimWhitespace: true });
	// protected ollamaCachePath = find('ollama', this.requestedOllamaVersion);
	// protected ollamaPath = join(this.ollamaCachePath, '..', '..');
	protected model: string = getInput('model', { required: true, trimWhitespace: true });
	// Do format(parse()) for input validation
	protected modelDir: string = format(parse(getInput('modelDir', { required: true, trimWhitespace: true })));

	protected get ollamaPath() {
		return join(find('ollama', this.requestedOllamaVersion), '..', '..');
	}
}
