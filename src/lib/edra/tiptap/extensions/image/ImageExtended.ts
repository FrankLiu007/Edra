import type { Node, NodeViewProps } from '@tiptap/core';
import Image, { type ImageOptions } from '@tiptap/extension-image';
import { SvelteNodeViewRenderer } from '../../index.ts';
import type { Component } from 'svelte';

/** 拒绝本地路径，避免扩展页尝试加载 file:// */
function isLocalFileSrc(src: string | null | undefined): boolean {
	if (!src) return false;
	const t = src.trim();
	return (
		/^file:\/\//i.test(t) ||
		/^[A-Za-z]:[\\/]/.test(t) ||
		/^\/(?:tmp|var)\b/i.test(t)
	);
}

export const ImageExtended = (component: Component<NodeViewProps>): Node<ImageOptions, unknown> => {
	return Image.extend({
		addAttributes() {
			return {
				src: {
					default: null,
					parseHTML: (element) => {
						const src = element.getAttribute('src');
						return isLocalFileSrc(src) ? null : src;
					}
				},
				alt: {
					default: null
				},
				title: {
					default: null
				},
				width: {
					default: '100%'
				},
				height: {
					default: null
				},
				align: {
					default: 'left'
				}
			};
		},
		addNodeView: () => {
			return SvelteNodeViewRenderer(component);
		}
	}).configure({
		allowBase64: false
	});
};
