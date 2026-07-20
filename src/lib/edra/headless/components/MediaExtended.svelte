<script lang="ts">
	import { Root, Trigger, Content, Item } from '../primitives/dropdown/index.ts';
	import { cn } from '$lib/utils.js';
	import AlignCenter from '@lucide/svelte/icons/text-align-center';
	import AlignLeft from '@lucide/svelte/icons/text-align-start';
	import AlignRight from '@lucide/svelte/icons/text-align-end';
	import Captions from '@lucide/svelte/icons/captions';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import Fullscreen from '@lucide/svelte/icons/fullscreen';
	import Trash from '@lucide/svelte/icons/trash-2';
	import type { NodeViewProps } from '@tiptap/core';
	import { NodeSelection } from '@tiptap/pm/state';
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import { duplicateContent } from '../../utils.js';
	import strings from '../../strings.js';
	import { NodeViewWrapper } from '$lib/edra/tiptap/index.js';
	import {
		ATOM_SLIGHT_PENETRATION_PX,
		atomPenetrationDepth,
		entrySideFromSelection,
		includeAtomInDragSelection,
		resolveAtomLeave,
		type AtomVerticalSide
	} from '../../tiptap/extensions/SelectAcrossAtoms.js';

	interface MediaExtendedProps extends NodeViewProps {
		children: Snippet<[]>;
		mediaRef?: HTMLElement;
	}

	type ResizeSide = 'left' | 'right';
	type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

	const {
		node,
		editor,
		selected,
		deleteNode,
		updateAttributes,
		getPos,
		children,
		mediaRef = $bindable()
	}: MediaExtendedProps = $props();

	const minWidthPercent = 20;
	const maxWidthPercent = 100;

	const corners: { id: Corner; side: ResizeSide }[] = [
		{ id: 'top-left', side: 'left' },
		{ id: 'top-right', side: 'right' },
		{ id: 'bottom-left', side: 'left' },
		{ id: 'bottom-right', side: 'right' }
	];

	let nodeRef = $state<HTMLElement | undefined>();
	let resizing = $state(false);
	/** 拖动开始时编辑器内容区宽度（固定，避免随图片变窄导致百分比非线性） */
	let resizingContainerWidth = $state(0);
	let resizingInitialWidthPx = $state(0);
	let resizingInitialMouseX = $state(0);
	let resizingPosition = $state<ResizeSide>('right');
	let openedMore = $state(false);

	/** 拖选访问状态：真正进入后并入；离开时按同侧/对侧决定是否保留 */
	let dragActive = false;
	let dragMaxPenetration = 0;
	let dragIncluded = false;
	let dragEntrySide: AtomVerticalSide | null = null;
	let dragSavedAnchor = 0;

	/** 仅点击选中该节点时显示缩放/工具栏；框选包含时只显示边框 */
	const isNodeOnlySelection = $derived.by(() => {
		void selected;
		const pos = getPos();
		if (typeof pos !== 'number') return false;
		const sel = editor.state.selection;
		return sel instanceof NodeSelection && sel.from === pos;
	});
	const showControls = $derived(isNodeOnlySelection || openedMore || resizing);

	function ensureNodeSelected() {
		const pos = getPos();
		if (typeof pos === 'number') {
			editor.chain().setNodeSelection(pos).run();
		}
	}

	function resetDragVisit() {
		dragActive = false;
		dragMaxPenetration = 0;
		dragIncluded = false;
		dragEntrySide = null;
		dragSavedAnchor = 0;
	}

	function isDragSelecting(e: MouseEvent | PointerEvent): boolean {
		return editor.isEditable && !resizing && e.buttons === 1;
	}

	function updateDragPenetration(e: MouseEvent | PointerEvent) {
		const el = nodeRef;
		if (!el) return;
		const pen = atomPenetrationDepth(e.clientX, e.clientY, el.getBoundingClientRect());
		dragMaxPenetration = Math.max(dragMaxPenetration, pen);
	}

	/**
	 * 拖选进入媒体：穿透够深后立刻把图片并入选区。
	 * 记录进入侧与进入前 anchor，供离开时判断保留/排除。
	 */
	function onDragEnterMedia(e: MouseEvent | PointerEvent) {
		if (!isDragSelecting(e)) return;

		const pos = getPos();
		if (typeof pos !== 'number') return;

		const sel = editor.state.selection;
		const nodeStart = pos;
		const nodeEnd = pos + node.nodeSize;

		if (sel instanceof NodeSelection && sel.from === nodeStart) return;
		if (sel.empty) return;

		if (!dragActive) {
			const side = entrySideFromSelection(sel, nodeStart, nodeEnd);
			dragActive = true;
			dragSavedAnchor = sel.anchor;
			dragEntrySide = side;
			dragIncluded = sel.from <= nodeStart && sel.to >= nodeEnd;
		}

		updateDragPenetration(e);
		tryIncludeAfterPenetration(nodeStart, nodeEnd);

		if (editor.state.selection.from <= nodeStart && editor.state.selection.to >= nodeEnd) {
			e.stopPropagation();
		}
	}

	function tryIncludeAfterPenetration(nodeStart: number, nodeEnd: number) {
		if (dragIncluded || !dragEntrySide) return;
		if (dragMaxPenetration < ATOM_SLIGHT_PENETRATION_PX) return;
		includeAtomInDragSelection(editor.view, nodeStart, nodeEnd);
		dragIncluded = true;
	}

	function onDragMoveMedia(e: MouseEvent | PointerEvent) {
		if (!isDragSelecting(e)) return;
		if (!dragActive) {
			onDragEnterMedia(e);
			return;
		}

		const pos = getPos();
		if (typeof pos !== 'number') return;

		updateDragPenetration(e);
		tryIncludeAfterPenetration(pos, pos + node.nodeSize);

		const sel = editor.state.selection;
		if (sel.from <= pos && sel.to >= pos + node.nodeSize) {
			e.stopPropagation();
		}
	}

	/**
	 * 拖选离开媒体：
	 * - 同侧离开（误入后返回）→ 选区不应包含图片
	 * - 对侧离开（穿过图片）→ 选区应包含图片
	 */
	function onDragLeaveMedia(e: MouseEvent | PointerEvent) {
		if (!dragActive) return;

		const related = e.relatedTarget;
		if (related instanceof Node && nodeRef?.contains(related)) return;

		const pos = getPos();
		const entrySide = dragEntrySide;
		const savedAnchor = dragSavedAnchor;
		const included = dragIncluded;
		const el = nodeRef;
		resetDragVisit();

		if (!isDragSelecting(e) || typeof pos !== 'number' || !entrySide || !el) return;

		resolveAtomLeave(editor.view, {
			nodeStart: pos,
			nodeEnd: pos + node.nodeSize,
			entrySide,
			savedAnchor,
			included,
			clientX: e.clientX,
			clientY: e.clientY,
			rect: el.getBoundingClientRect()
		});
	}

	/** 百分比宽度相对的是编辑器内容区，不是图片自身容器 */
	function getResizeContainerWidth(): number {
		const editorWidth = editor.view.dom.clientWidth;
		if (editorWidth > 0) return editorWidth;
		const outer = nodeRef?.parentElement?.parentElement;
		return outer?.clientWidth || nodeRef?.parentElement?.clientWidth || 1;
	}

	function startResize(e: MouseEvent | TouchEvent, side: ResizeSide) {
		e.preventDefault();
		e.stopPropagation();
		ensureNodeSelected();
		resizing = true;
		resizingPosition = side;
		const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
		resizingInitialMouseX = clientX;
		resizingContainerWidth = getResizeContainerWidth();
		resizingInitialWidthPx = mediaRef?.offsetWidth || nodeRef?.offsetWidth || 0;
	}

	function applyWidthDelta(clientX: number) {
		if (!resizing || resizingContainerWidth <= 0) return;
		let dx = clientX - resizingInitialMouseX;
		if (resizingPosition === 'left') {
			dx = resizingInitialMouseX - clientX;
		}
		const newWidthPx = resizingInitialWidthPx + dx;
		const newWidthPercent = Math.max(
			Math.min((newWidthPx / resizingContainerWidth) * 100, maxWidthPercent),
			minWidthPercent
		);
		updateAttributes({ width: `${newWidthPercent}%` });
	}

	function resize(e: MouseEvent) {
		applyWidthDelta(e.clientX);
	}

	function endResize() {
		resizing = false;
		resizingInitialMouseX = 0;
		resizingInitialWidthPx = 0;
		resizingContainerWidth = 0;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!resizing) return;
		applyWidthDelta(e.touches[0].clientX);
	}

	function handleTouchEnd() {
		endResize();
	}

	onMount(() => {
		window.addEventListener('mousemove', resize);
		window.addEventListener('mouseup', endResize);
		window.addEventListener('touchmove', handleTouchMove, { passive: false });
		window.addEventListener('touchend', handleTouchEnd);
	});

	onDestroy(() => {
		window.removeEventListener('mousemove', resize);
		window.removeEventListener('mouseup', endResize);
		window.removeEventListener('touchmove', handleTouchMove);
		window.removeEventListener('touchend', handleTouchEnd);
	});
</script>

<NodeViewWrapper
	class={cn(
		'media-extended-outer',
		node.attrs.align === 'left' && 'align-left',
		node.attrs.align === 'center' && 'align-center',
		node.attrs.align === 'right' && 'align-right'
	)}
	style={`width: ${node.attrs.width}`}
>
	<div
		bind:this={nodeRef}
		class="media-group"
		class:selected={selected || resizing}
		class:resizing
		onmouseenter={onDragEnterMedia}
		onmousemove={onDragMoveMedia}
		onmouseleave={onDragLeaveMedia}
		onpointerenter={onDragEnterMedia}
		onpointermove={onDragMoveMedia}
		onpointerleave={onDragLeaveMedia}
	>
		{@render children()}
		{#if node.attrs.title !== null && node.attrs.title.trim() !== ''}
			<input
				value={node.attrs.title}
				type="text"
				class="media-title-input"
				onchange={(e) => {
					const target = e.target as HTMLInputElement;
					updateAttributes({ title: target.value });
				}}
			/>
		{/if}
		{#if editor.isEditable && showControls}
			{#each corners as corner (corner.id)}
				<button
					type="button"
					class="resize-corner"
					class:resize-corner-top-left={corner.id === 'top-left'}
					class:resize-corner-top-right={corner.id === 'top-right'}
					class:resize-corner-bottom-left={corner.id === 'bottom-left'}
					class:resize-corner-bottom-right={corner.id === 'bottom-right'}
					aria-label={corner.side === 'left'
						? strings.extension.media.resizeLeft
						: strings.extension.media.resizeRight}
					onmousedown={(event: MouseEvent) => startResize(event, corner.side)}
					ontouchstart={(event: TouchEvent) => startResize(event, corner.side)}
				>
					<span class="resize-corner-grip"></span>
				</button>
			{/each}

			<div class={cn('media-toolbar', openedMore && 'opened')}>
				<button
					class="edra-btn edra-btn-ghost edra-btn-icon-xs {node.attrs.align === 'left'
						? 'media-align-active'
						: ''}"
					onclick={() => updateAttributes({ align: 'left' })}
					title={strings.extension.media.alignLeft}
				>
					<AlignLeft class="media-icon" />
				</button>
				<button
					class="edra-btn edra-btn-ghost edra-btn-icon-xs {node.attrs.align === 'center'
						? 'media-align-active'
						: ''}"
					onclick={() => updateAttributes({ align: 'center' })}
					title={strings.extension.media.alignCenter}
				>
					<AlignCenter class="media-icon" />
				</button>
				<button
					class="edra-btn edra-btn-ghost edra-btn-icon-xs {node.attrs.align === 'right'
						? 'media-align-active'
						: ''}"
					onclick={() => updateAttributes({ align: 'right' })}
					title={strings.extension.media.alignRight}
				>
					<AlignRight class="media-icon" />
				</button>

				<Root bind:open={openedMore}>
					<Trigger
						class="edra-btn edra-btn-ghost edra-btn-icon-xs"
						title={strings.extension.media.moreOptions}
					>
						<EllipsisVertical class="media-icon" />
					</Trigger>
					<Content align="start" class="more-options-menu">
						<Item
							onclick={() => {
								if (node.attrs.title === null || node.attrs.title.trim() === '') {
									const defaultCaptions: Record<string, string> = {
										audio: 'Audio Caption',
										image: 'Image Caption',
										video: 'Video Caption',
										iframe: 'Caption'
									};
									updateAttributes({
										title:
											defaultCaptions[node.type.name] ||
											strings.extension.media.captionPlaceholder
									});
								}
							}}
						>
							<Captions class="media-icon" />
							<span>{strings.extension.media.caption}</span>
						</Item>
						<Item
							onclick={() => {
								duplicateContent(editor, node);
							}}
						>
							<CopyIcon class="media-icon" />
							<span>{strings.extension.media.duplicate}</span>
						</Item>
						<Item
							onclick={() => {
								updateAttributes({
									width: '100%'
								});
							}}
						>
							<Fullscreen class="media-icon" />
							<span>{strings.extension.media.fullscreen}</span>
						</Item>
						<Item
							onclick={() => {
								deleteNode();
							}}
							class="text-(--edra-error) hover:bg-(--edra-error-soft)"
						>
							<Trash class="media-icon" />
							<span>{strings.extension.media.delete}</span>
						</Item>
					</Content>
				</Root>
			</div>
		{/if}
	</div>
</NodeViewWrapper>

<style>
	:global(.media-extended-outer) {
		position: relative;
		display: flex;
		flex-direction: column;
		margin-top: 1rem;
		margin-bottom: 1rem;
	}
	:global(.media-extended-outer.align-left) {
		left: 0;
		transform: translateX(0);
	}
	:global(.media-extended-outer.align-center) {
		left: 50%;
		transform: translateX(-50%);
	}
	:global(.media-extended-outer.align-right) {
		left: 100%;
		transform: translateX(-100%);
	}

	.media-group {
		position: relative;
		display: flex;
		flex-direction: column;
		border-radius: var(--edra-radius-md, 6px);
		border: 2px solid transparent;
		outline: none;
		transition: border-color 120ms ease, box-shadow 120ms ease;
	}
	.media-group.selected {
		border-color: var(--edra-link, #3b82f6);
		box-shadow: 0 0 0 1px var(--edra-link, #3b82f6);
	}
	.media-group.resizing {
		user-select: none;
	}

	.media-title-input {
		color: var(--edra-body);
		margin-top: 0.25rem;
		margin-bottom: 0.25rem;
		width: 100%;
		background-color: transparent;
		text-align: center;
		font-size: 0.875rem;
		outline: none;
		border: none;
		border-bottom: 1px solid transparent;
	}
	.media-title-input:focus {
		border-bottom-color: var(--edra-border);
	}

	.resize-corner {
		position: absolute;
		z-index: 30;
		width: 14px;
		height: 14px;
		padding: 0;
		border: none;
		background: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
	}
	.resize-corner-top-left {
		top: -7px;
		left: -7px;
		cursor: nwse-resize;
	}
	.resize-corner-top-right {
		top: -7px;
		right: -7px;
		cursor: nesw-resize;
	}
	.resize-corner-bottom-left {
		bottom: -7px;
		left: -7px;
		cursor: nesw-resize;
	}
	.resize-corner-bottom-right {
		bottom: -7px;
		right: -7px;
		cursor: nwse-resize;
	}
	.resize-corner-grip {
		display: block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background-color: var(--edra-canvas, #fff);
		border: 2px solid var(--edra-link, #3b82f6);
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
	}
	.resize-corner:hover .resize-corner-grip,
	.resize-corner:focus-visible .resize-corner-grip {
		background-color: var(--edra-link, #3b82f6);
		transform: scale(1.1);
	}

	.media-toolbar {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--edra-border);
		padding: 4px;
		background-color: var(--edra-canvas);
		top: -0.5rem;
		left: 50%;
		transform: translate(-50%, -100%);
		z-index: 20;
		border-radius: var(--edra-radius-md);
		box-shadow: var(--edra-shadow-3);
	}
	.media-align-active {
		background-color: var(--edra-canvas-soft-2) !important;
		color: var(--edra-ink) !important;
	}
	:global(.media-icon) {
		width: 0.875rem;
		height: 0.875rem;
	}
	:global(.more-options-menu) {
		margin-top: 4px !important;
		font-size: 0.875rem !important;
	}
</style>
