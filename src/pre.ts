import { isFeatureAvailable as isGhCacheAvailable } from '@actions/cache';
import { addPath, exportVariable, getBooleanInput, getInput, info, toPlatformPath, warning } from '@actions/core';
import { exec } from '@actions/exec';
import { getOctokit } from '@actions/github';
import { cacheDir, cacheFile, downloadTool, evaluateVersions, extract7z, extractTar, extractXar, extractZip } from '@actions/tool-cache';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { constants, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, coerce } from 'semver';
import { BaseCore } from './base.js';
import { FileHasher } from './fileHasher.js';

export class PreCore extends BaseCore {
	private requestedOllamaVersion = getInput('ollama-version', { required: true, trimWhitespace: true });
	private forceCheck = getBooleanInput('check-latest', { required: true, trimWhitespace: true });
	private octokit = getOctokit(getInput('token', { required: true, trimWhitespace: true }));

	constructor() {
		super();

		exportVariable('COLDFUSION_CORE_PRE_EXECUTED', `${true}`);
	}

	private static get ollamaInstalled() {
		return exec('ollama', undefined, { silent: true })
			.then((exitCode) => {
				console.debug('ollama exit code', exitCode);
				return true;
			})
			.catch();
	}

	private get ollamaVersionHttp() {
		return this.octokit
			.paginate('GET /repos/{owner}/{repo}/releases', {
				owner: 'ollama',
				repo: 'ollama',
				// Max 100 https://docs.github.com/en/rest/releases/releases#list-releases
				per_page: 100,
			})
			.then((data) => {
				const targetVersion = evaluateVersions(
					data.map((release) => clean(release.tag_name)!),
					this.requestedOllamaVersion,
				);

				return data.find((release) => clean(release.tag_name)! === targetVersion);
			})
			.catch((e) => {
				throw e;
			});
	}

	private installOllama() {
		return this.ollamaVersionHttp.then((release) => {
			const os = getInput('os', { required: true, trimWhitespace: true }).toLowerCase() as 'linux' | 'windows' | 'macos';
			const arch = getInput('arch', { required: true, trimWhitespace: true }).toLowerCase() as 'x86' | 'x64' | 'arm' | 'arm64';
			const executableAsset = release?.assets.find((asset) => {
				switch (os) {
					case 'macos':
						return asset.name.toLowerCase().includes('darwin') && !asset.name.toLowerCase().endsWith('.zip');
					case 'linux':
						switch (arch) {
							case 'x64':
								return asset.name.toLowerCase().includes(os) && !asset.name.toLowerCase().endsWith('amd64');
							case 'arm64':
								return asset.name.toLowerCase().includes(os) && !asset.name.toLowerCase().endsWith(arch);
							default:
								return false;
						}
					case 'windows':
						switch (arch) {
							case 'x64':
								return asset.name.toLowerCase().includes(os) && !asset.name.toLowerCase().endsWith('amd64.zip');
							default:
								return false;
						}
				}
			});
			const hashAsset = release?.assets.find((asset) => /^sha\d{3}sum/i.test(asset.name.toLowerCase()));
			toPlatformPath;
			if (executableAsset && hashAsset) {
				const isArchive = ['.zip', '.7z', '.pkg', '.tar.gz'].some((extension) => executableAsset!.name.toLowerCase().endsWith(extension));

				return Promise.all([
					// Download to tmp if archive otherwise straight to destination
					downloadTool(executableAsset!.browser_download_url, join(tmpdir(), executableAsset!.name)),
					fetch(new URL(hashAsset!.browser_download_url))
						.then((response) => response.text())
						.then((hashFile) => {
							const lines = hashFile.split('\n');
							const [expectedHash] = lines.find((line) => line.endsWith(executableAsset!.name))?.split(' ') ?? [];
							if (expectedHash) {
								return expectedHash;
							} else {
								throw new Error('file not in hashes', { cause: lines });
							}
						}),
				]).then(([ollamaPath, expectedHash]) => {
					const hashType = /^sha\d{3}/i.exec(hashAsset!.name.toLowerCase())![0];
					return FileHasher.hashFile(ollamaPath, hashType).then(async (computedHash) => {
						if (timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(expectedHash!, 'hex'))) {
							if (isArchive) {
								// Extract if needed
								if (ollamaPath.endsWith('.zip')) {
									ollamaPath = await extractZip(ollamaPath);
								} else if (ollamaPath.endsWith('.7z')) {
									ollamaPath = await extract7z(ollamaPath);
								} else if (ollamaPath.endsWith('.pkg')) {
									ollamaPath = await extractXar(ollamaPath);
								} else if (ollamaPath.endsWith('.tar.gz')) {
									ollamaPath = await extractTar(ollamaPath);
								}

								console.info('cacheDir', ollamaPath, 'ollama', coerce(release!.tag_name)!.toString());

								return cacheDir(ollamaPath, 'ollama', coerce(release!.tag_name)!.toString()).then((cachedPath) => addPath(join(cachedPath, os === 'windows' ? 'ollama.exe' : 'ollama')));
							} else {
								console.info('cacheFile', ollamaPath, os === 'windows' ? 'ollama.exe' : 'ollama', 'ollama', coerce(release!.tag_name)!.toString());

								return cacheFile(ollamaPath, os === 'windows' ? 'ollama.exe' : 'ollama', 'ollama', coerce(release!.tag_name)!.toString()).then((cachedPath) => addPath(cachedPath));
							}
						} else {
							throw new Error('Hash mismatch', { cause: JSON.stringify({ expected: expectedHash, computed: computedHash }) });
						}
					});
				});
			} else {
				throw new Error('Executable and hash not found', { cause: JSON.stringify({ executableAsset, hashAsset }) });
			}
		});

		// https://medium.com/@chhaybunsy/unleash-your-machine-learning-models-how-to-customize-ollamas-storage-directory-c9ea1ea2961a
	}

	public async main() {
		info(`Creating folder and parent(s): ${this.modelDir}`);

		/**
		 * @link https://github.com/nischalj10/headless-ollama/blob/master/preload.sh
		 * Install ollama
		 */
		return PreCore.ollamaInstalled
			.then(() => {
				if (this.forceCheck) {
					/**
					 * @todo
					 * */
				}
			})
			.catch(() => {
				return this.installOllama();
			})
			.finally(() =>
				mkdir(this.modelDir, {
					recursive: true,
					// u=rwx,g=rx,o=rx
					mode: constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR | constants.S_IRGRP | constants.S_IXGRP | constants.S_IROTH | constants.S_IXOTH,
				})
					.then(() => {
						if (isGhCacheAvailable()) {
						} else {
							warning('Cache service not available. Falling back to download');
						}
					})
					.catch(),
			);
	}
}

await new PreCore().main();
