import { getInput } from '@actions/core';
import { format, join, parse } from 'node:path';

export class BaseCore {
	protected model: string = getInput('model', { required: true, trimWhitespace: true });
	// Do format(parse()) for input validation
	protected modelDir: string = join(format(parse(getInput('modelDir', { required: true, trimWhitespace: true }))), 'ChainFuse', 'ColdFusion', 'models');
}
