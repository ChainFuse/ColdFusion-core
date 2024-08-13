import { getInput } from '@actions/core';
import { format, parse } from 'node:path';

export class BaseCore {
	protected model: string = getInput('model', { required: true, trimWhitespace: true });
	// Do format(parse()) for input validation
	protected modelDir: string = format(parse(getInput('modelDir', { required: true, trimWhitespace: true })));
}
