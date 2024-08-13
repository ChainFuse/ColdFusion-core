import { getInput } from '@actions/core';
import { find } from '@actions/tool-cache';
import { format, parse } from 'node:path';

export class BaseCore {
	protected requestedOllamaVersion = getInput('ollama-version', { required: true, trimWhitespace: true });
	protected ollamaPath = find('ollama', this.requestedOllamaVersion).split(/[\/\\]/i);
	protected model: string = getInput('model', { required: true, trimWhitespace: true });
	// Do format(parse()) for input validation
	protected modelDir: string = format(parse(getInput('modelDir', { required: true, trimWhitespace: true })));
}
