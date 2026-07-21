import { mergeAttributes, Node, type Editor, type NodeViewProps } from '@tiptap/core';
import { SvelteNodeViewRenderer } from '../index.ts';
import type { Component } from 'svelte';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';

export interface MediaPlaceholderOptions {
	HTMLAttributes: Record<string, unknown>;
	onUpload?: (file: File) => Promise<string>;
}

type MediaKind = 'image' | 'video' | 'audio' | 'iframe';

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		mediaPlaceholder: {
			/**
			 * Inserts a media placeholder
			 */
			insertMediaPlaceholder: (options: {
				mediaType: MediaKind;
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
			onUpload?: (file: File) => Promise<string>;
		};
	}
}

/** Local file image paths that browsers reject in web contexts (e.g. QQ screenshot paste). */
const LOCAL_FILE_SRC_RE = /^(?:file:\/\/|[A-Za-z]:[\\/]|\/(?:tmp|var)\b)/i;

function isLocalFileImageSrc(src: string): boolean {
	const trimmed = src.trim();
	if (!trimmed) return false;
	try {
		const decoded = decodeURIComponent(trimmed);
		return LOCAL_FILE_SRC_RE.test(trimmed) || LOCAL_FILE_SRC_RE.test(decoded);
	} catch {
		return LOCAL_FILE_SRC_RE.test(trimmed);
	}
}

function extractImgSrc(imgTag: string): string | null {
	const quoted = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(imgTag);
	if (quoted) return quoted[2];
	const bare = /\bsrc\s*=\s*([^\s>]+)/i.exec(imgTag);
	return bare ? bare[1] : null;
}

/** Strip local-path <img> tags from HTML without touching the DOM (never use innerHTML). */
function stripLocalFileImageTags(html: string): string {
	return html.replace(/<img\b[^>]*>/gi, (tag) => {
		const src = extractImgSrc(tag);
		return src && isLocalFileImageSrc(src) ? '' : tag;
	});
}

function isMediaFile(file: File): boolean {
	return /^(image|video|audio)\//i.test(file.type);
}

function mediaTypeFromFile(file: File): Exclude<MediaKind, 'iframe'> {
	if (file.type.startsWith('video/')) return 'video';
	if (file.type.startsWith('audio/')) return 'audio';
	return 'image';
}

function collectMediaFiles(dataTransfer: DataTransfer | null | undefined): File[] {
	if (!dataTransfer) return [];

	const fromFiles = Array.from(dataTransfer.files ?? []).filter(isMediaFile);
	if (fromFiles.length > 0) return fromFiles;

	const fromItems: File[] = [];
	for (const item of Array.from(dataTransfer.items ?? [])) {
		if (item.kind !== 'file' || !/^(image|video|audio)\//i.test(item.type)) continue;
		const file = item.getAsFile();
		if (file) fromItems.push(file);
	}
	return fromItems;
}

function resolveUploadHandler(
	editor: Editor,
	fallback?: (file: File) => Promise<string>
): ((file: File) => Promise<string>) | undefined {
	return editor.storage.mediaPlaceholder.onUpload || fallback;
}

function insertMediaByType(editor: Editor, src: string, mediaType: Exclude<MediaKind, 'iframe'>) {
	editor.view.focus();
	if (mediaType === 'audio') {
		editor.commands.setAudio({ src });
	} else if (mediaType === 'video') {
		editor.commands.setVideo({ src });
	} else {
		editor.commands.setImage({ src });
	}
}

function uploadAndInsertFiles(
	editor: Editor,
	onUpload: (file: File) => Promise<string>,
	files: File[],
	mediaTypeOverride?: Exclude<MediaKind, 'iframe'>
) {
	void (async () => {
		for (const file of files) {
			try {
				const src = await onUpload(file);
				insertMediaByType(editor, src, mediaTypeOverride ?? mediaTypeFromFile(file));
			} catch (error) {
				console.error('Failed to upload media:', error);
			}
		}
	})();
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
						const onUpload = resolveUploadHandler(editor, this.options.onUpload);
						if (!onUpload) {
							throw new Error('onUpload is not defined');
						}

						// Prefer placeholder attrs when replacing a selected placeholder node
						let mediaType: Exclude<MediaKind, 'iframe'> = mediaTypeFromFile(file);
						const { selection } = editor.state;
						if (selection instanceof NodeSelection) {
							const selectedNode = selection.node;
							if (selectedNode.type.name === this.name) {
								const attrType = selectedNode.attrs.mediaType as MediaKind;
								if (attrType === 'image' || attrType === 'video' || attrType === 'audio') {
									mediaType = attrType;
								}
							}
						}

						uploadAndInsertFiles(editor, onUpload, [file], mediaType);
						return true;
					}
			};
		},

		addProseMirrorPlugins() {
			const extension = this;

			return [
				new Plugin({
					key: new PluginKey('edraMediaFileHandler'),
					props: {
						/**
						 * Safety net: never let file:// (or other local-path) imgs enter the doc.
						 * QQ / WeChat / Outlook often paste HTML with Temp paths; loading them throws
						 * "Not allowed to load local resource".
						 */
						transformPastedHTML(html) {
							return stripLocalFileImageTags(html);
						},

						handlePaste(_view, event) {
							const clipboardData = event.clipboardData;
							if (!clipboardData) return false;

							const mediaFiles = collectMediaFiles(clipboardData);
							const onUpload = resolveUploadHandler(extension.editor, extension.options.onUpload);

							// Real clipboard binary (incl. QQ screenshot) → same onFileUpload as file picker
							if (mediaFiles.length > 0 && onUpload) {
								event.preventDefault();
								uploadAndInsertFiles(extension.editor, onUpload, mediaFiles);
								return true;
							}

							// No binary / no uploader: default paste may still carry file:// HTML.
							// transformPastedHTML strips those imgs so the console error never fires.
							return false;
						},

						handleDrop(_view, event, _slice, moved) {
							if (moved || !event.dataTransfer) return false;

							const mediaFiles = collectMediaFiles(event.dataTransfer);
							if (mediaFiles.length === 0) return false;

							const onUpload = resolveUploadHandler(extension.editor, extension.options.onUpload);
							if (!onUpload) return false;

							event.preventDefault();
							uploadAndInsertFiles(extension.editor, onUpload, mediaFiles);
							return true;
						}
					}
				})
			];
		}
	});
