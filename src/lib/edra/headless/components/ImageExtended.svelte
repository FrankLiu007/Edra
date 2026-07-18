<script lang="ts">
	import type { NodeViewProps } from '@tiptap/core';
	import MediaExtended from './MediaExtended.svelte';

	const { ...rest }: NodeViewProps = $props();

	let mediaRef = $state<HTMLElement>();

	/** 扩展页禁止加载 file:// 本地资源 */
	function safeImageSrc(src: unknown): string {
		if (typeof src !== 'string' || !src) return '';
		const t = src.trim();
		if (/^file:\/\//i.test(t) || /^[A-Za-z]:[\\/]/.test(t) || /^\/(?:tmp|var)\b/i.test(t)) {
			return '';
		}
		return t;
	}
</script>

<MediaExtended bind:mediaRef {...rest}>
	{@const node = rest.node}
	<img
		bind:this={mediaRef}
		src={safeImageSrc(node.attrs.src)}
		alt={node.attrs.alt}
		title={node.attrs.title}
		class="img-custom"
	/>
</MediaExtended>

<style>
	.img-custom {
		margin: 0;
		width: 100%;
		border-radius: var(--edra-radius-md);
		object-fit: cover;
	}
</style>
