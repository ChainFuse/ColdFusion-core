export type ISO_DATE = `${number}-${number}-${number}T${number}:${number}:${number}.${number}Z`;

export interface HuggingFaceRepo {
	_id: string;
	id: string;
	modelId: `${string}/${string}`;
	author: string;
	sha: string;
	lastModified: ISO_DATE;
	private: boolean;
	disabled: boolean;
	gated: boolean;
	tags: string[];
	downloads: number;
	library_name: string;
	likes: number;
	'model-index': unknown | null;
	config: {
		model_type: string;
	};
	cardData: {
		base_model: `${string}/${string}`;
		inference: boolean;
		license: string;
		model_creator: string;
		model_name: string;
		model_type: string;
		prompt_template: string;
		quantized_by: string;
	};
	transformersInfo: {
		auto_model: string;
	};
	spaces: unknown[];
	siblings: {
		rfilename: string;
	}[];
	createdAt: ISO_DATE;
}
