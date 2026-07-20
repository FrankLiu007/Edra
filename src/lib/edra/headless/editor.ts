import {
	AIHighlight,
	Callout,
	IFrameExtended,
	ImageExtended,
	Mermaid,
	SlashCommand,
	SvelteNodeViewRenderer,
	useEditor,
	VideoExtended,
	type Editor
} from '../tiptap/index.ts';
import { all, createLowlight } from 'lowlight';
import {
	baseExtensions,
	BlockMathWithDecode,
	InlineMathWithDecode,
	katexOptions
} from '../extensions.ts';
const lowlight = createLowlight(all);
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CodeBlock from './components/CodeBlock.svelte';
import { MediaPlaceholder } from '../tiptap/extensions/MediaPlaceHolder.ts';
import MediaPlaceholderComp from './components/MediaPlaceHolder.svelte';
import ImageExtendedComp from './components/ImageExtended.svelte';
import VideoExtendedComp from './components/VideoExtended.svelte';
import IFrameComp from './components/IFrame.svelte';
import MermaidComp from './components/Mermaid.svelte';
import SlashCommandComp from './components/SlashCommand.svelte';
import CalloutComp from './components/Callout.svelte';
import type { EditorView } from '@tiptap/pm/view';
import type { Node } from '@tiptap/pm/model';

export type MathClickHandler = (
	node: Node,
	pos: number,
	isBlock: boolean,
	editor: Editor
) => void;

export type HandlePaste = (view: EditorView, event: ClipboardEvent) => boolean;

export interface EdraEditorProps {
	onUpdate?: () => void;
	/**
	 * Callback function to handle file uploads when a user drags/drops, pastes,
	 * or selects a media file (image, video, audio) to insert.
	 * It should upload the file to your storage (e.g., S3, Vercel Blob, etc.)
	 * and return a promise resolving to the public URL, or an attrs object
	 * with at least `src` (e.g. `{ src, 'data-image-id': id }`).
	 *
	 * @param file The file to be uploaded.
	 * @returns A promise resolving to the uploaded file's URL or image attrs.
	 */
	onFileUpload?: (
		file: File
	) => Promise<string | ({ src: string } & Record<string, unknown>)>;
	callAI?: (
		prompt: string,
		onChunk: (chunk: string) => void,
		onError: (error: Error) => void
	) => Promise<void>;
	/** Math node click → host UI (e.g. MathLive). */
	onMathClick?: MathClickHandler;
	/**
	 * Custom paste handler (e.g. smart paste). Return true to consume the event.
	 */
	handlePaste?: HandlePaste;
}

export const createEditor = (props?: EdraEditorProps) => {
	let editorRef: Editor | undefined;

	const onMathClick = props?.onMathClick;
	const handlePaste = props?.handlePaste;

	const editor = useEditor({
		extensions: [
			...baseExtensions,
			BlockMathWithDecode.configure({
				katexOptions,
				onClick: onMathClick
					? (node, pos) => {
							if (editorRef) onMathClick(node, pos, true, editorRef);
						}
					: undefined
			}),
			InlineMathWithDecode.configure({
				katexOptions,
				onClick: onMathClick
					? (node, pos) => {
							if (editorRef) onMathClick(node, pos, false, editorRef);
						}
					: undefined
			}),
			CodeBlockLowlight.configure({
				lowlight
			}).extend({
				addNodeView() {
					return SvelteNodeViewRenderer(CodeBlock);
				}
			}),
			MediaPlaceholder(MediaPlaceholderComp).configure({
				onUpload: props?.onFileUpload
			}),
			ImageExtended(ImageExtendedComp),
			VideoExtended(VideoExtendedComp),
			IFrameExtended(IFrameComp),
			Mermaid(MermaidComp),
			SlashCommand(SlashCommandComp),
			Callout(CalloutComp),
			AIHighlight.configure({
				callAI: props?.callAI || null
			})
		],
		onUpdate: props?.onUpdate || (() => {}),
		// Do not pass editorProps: undefined — it overwrites TipTap's default {}
		// and crashes createView on editorProps.dispatchTransaction.
		...(handlePaste
			? {
					editorProps: {
						handlePaste: (view, event) => handlePaste(view, event)
					}
				}
			: {})
	});

	editorRef = editor;
	return editor;
};
