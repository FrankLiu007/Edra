import { mergeAttributes, Node, type NodeViewProps } from '@tiptap/core';
import { SvelteNodeViewRenderer } from '../index.ts';
import type { Component } from 'svelte';
import { NodeSelection } from '@tiptap/pm/state';

/** URL string, or attrs object (must include `src`) for setImage / setVideo / setAudio */
export type MediaUploadResult = string | ({ src: string } & Record<string, unknown>);

export interface MediaPlaceholderOptions {
	HTMLAttributes: Record<string, unknown>;
	onUpload?: (file: File) => Promise<MediaUploadResult>;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		mediaPlaceholder: {
			/**
			 * Inserts a media placeholder
			 */
			insertMediaPlaceholder: (options: {
				mediaType: 'image' | 'video' | 'audio' | 'iframe';
			}) => ReturnType;

			/**
			 * Set the upload handler
			 */
			setMediaUploadHandler: (handler: (file: File) => Promise<string>) => ReturnType;

			/**
			 * Upload a media and insert the result
			 */
			uploadMedia: (file: File) => ReturnType;
		};
	}

	interface Storage {
		mediaPlaceholder: {
			onUpload?: (file: File) => Promise<MediaUploadResult>;
		};
	}
}

export const MediaPlaceholder = (component: Component<NodeViewProps>) =>
	Node.create<MediaPlaceholderOptions>({
		name: 'mediaPlaceholder',

		addOptions() {
			return {
				HTMLAttributes: {},
				onUpload: undefined
			};
		},

		addStorage() {
			return {
				onUpload: this.options.onUpload
			};
		},

		addAttributes() {
			return {
				mediaType: {
					default: 'image',
					parseHTML: (element) => element.getAttribute('data-media-type'),
					renderHTML: (attributes) => {
						if (!attributes.mediaType) {
							return {};
						}
						return {
							'data-media-type': attributes.mediaType
						};
					}
				}
			};
		},

		parseHTML() {
			return [{ tag: `div[data-type="${this.name}"]` }];
		},

		renderHTML({ HTMLAttributes }) {
			return [
				'div',
				mergeAttributes({ 'data-type': this.name }, this.options.HTMLAttributes, HTMLAttributes)
			];
		},

		group: 'block',
		draggable: true,
		atom: true,
		content: 'inline*',
		isolating: true,

		addNodeView() {
			return SvelteNodeViewRenderer(component);
		},

		addCommands() {
			return {
				insertMediaPlaceholder:
					(options) =>
					({ commands }) => {
						return commands.insertContent({
							type: this.name,
							attrs: {
								mediaType: options.mediaType
							}
						});
					},

				setMediaUploadHandler:
					(handler) =>
					({ editor }) => {
						editor.storage.mediaPlaceholder.onUpload = handler;
						return true;
					},

				uploadMedia:
					(file: File) =>
					({ editor }) => {
						const onUpload = editor.storage.mediaPlaceholder.onUpload || this.options.onUpload;
						if (!onUpload) {
							throw new Error('onUpload is not defined');
						}

						// Detect mediaType from current selection
						let mediaType = 'image';
						const { selection } = editor.state;
						if (selection instanceof NodeSelection) {
							const selectedNode = selection.node;
							if (selectedNode.type.name === this.name) {
								mediaType = selectedNode.attrs.mediaType;
							}
						}

						void onUpload(file)
							.then((result) => {
								const attrs = typeof result === 'string' ? { src: result } : result;
								if (!attrs?.src) {
									console.error('Failed to upload media: result missing src');
									return;
								}
								editor.view.focus();
								if (mediaType === 'audio') {
									editor.commands.setAudio({ src: attrs.src });
								} else if (mediaType === 'video') {
									editor.commands.setVideo({ src: attrs.src });
								} else {
									editor.commands.setImage(attrs);
								}
							})
							.catch((error) => {
								console.error('Failed to upload media:', error);
							});

						return true;
					}
			};
		}
	});
