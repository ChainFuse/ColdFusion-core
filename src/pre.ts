import { isFeatureAvailable } from '@actions/cache';
import { getInput } from '@actions/core';
import { join } from 'node:path';

if (isFeatureAvailable()) {
	console.log(getInput('model', { required: true }), getInput('quantMethod', { required: true }), getInput('modelDir', { required: true }));
	console.log(join(getInput('modelDir', { required: true }), getInput('model', { required: true })));
} else {
	// TODO: Download
}
