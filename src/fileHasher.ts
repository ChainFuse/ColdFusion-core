import { error } from '@actions/core';
import { create } from '@actions/glob';
import { createHash } from 'node:crypto';
import { createReadStream, stat } from 'node:fs';

export class FileHasher {
	private static async isFile(path: string) {
		return new Promise<boolean>((resolve, reject) => {
			stat(path, (err, stats) => {
				if (err) {
					error(`Error checking path (${path}): ${err}`);
					resolve(false);
					reject(err);
				} else {
					resolve(stats.isFile());
				}
			});
		});
	}

	public static hashFiles(incomingGlob: Parameters<typeof create>[0] | ReturnType<typeof create>) {
		let glob: ReturnType<typeof create>;
		if (typeof incomingGlob === 'string') {
			glob = create(incomingGlob);
		} else {
			glob = incomingGlob;
		}
		return new Promise<ReturnType<ReturnType<typeof createHash>['digest']>>((resolve, reject) => {
			glob.then((globber) => {
				globber
					.glob()
					.then((paths) => {
						Promise.all(
							paths.map(async (path) => {
								if (await this.isFile(path)) {
									return this.hashFile(path);
								}
								return '';
							}),
						)
							.then((fileHashes) => resolve(this.hashString(fileHashes.filter((hash) => hash !== '').join(''))))
							.catch(reject);
					})
					.catch(reject);
			}).catch(reject);
		});
	}

	private static async hashFile(path: string, hashType: Parameters<typeof createHash>[0] = 'sha256') {
		return new Promise<ReturnType<ReturnType<typeof createHash>['digest']>>((resolve, reject) => {
			const hash = createHash(hashType);
			const fileStream = createReadStream(path);

			fileStream.on('error', reject);
			hash.on('error', reject);
			hash.on('finish', () => resolve(hash.digest('hex')));

			fileStream.pipe(hash);
		});
	}

	private static hashString(data: string, hashType: Parameters<typeof createHash>[0] = 'sha256'): ReturnType<ReturnType<typeof createHash>['digest']> {
		return createHash(hashType).update(data).digest('hex');
	}
}
