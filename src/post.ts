import { info } from '@actions/core';
import { BaseCore } from './base.js';

class PostCore extends BaseCore {
	public async main() {
		info('Running post');
	}
}

await new PostCore().main();
