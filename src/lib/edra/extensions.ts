import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import strings from './strings.ts';
import Highlight from '@tiptap/extension-highlight';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import Subscript from '@tiptap/extension-subscript';
import TextAlign from '@tiptap/extension-text-align';
import SuperScript from '@tiptap/extension-superscript';
import { ColorHighlighter, Table, TableCell, TableHeader, TableRow } from './tiptap/index.ts';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Markdown } from '@tiptap/markdown';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import katex from 'katex';
import { Audio } from './tiptap/index.ts';

/** 解析/渲染前解码 data-latex 中的 HTML 实体（如 &amp;），否则 KaTeX 渲染 align 等会报错 */
function decodeLatexFromHtml(v: string | null | undefined): string {
	if (v == null || v === '') return '';
	return v
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

const latexAttr = {
	default: '',
	parseHTML: (element: HTMLElement) => decodeLatexFromHtml(element.getAttribute('data-latex')) || '',
	renderHTML: (attributes: { latex?: string }) => ({ 'data-latex': attributes.latex })
};

const katexOptions = {
	throwOnError: true,
	macros: {
		'\\R': '\\mathbb{R}',
		'\\N': '\\mathbb{N}'
	}
};

export const BlockMathWithDecode = BlockMath.extend({
	addAttributes() {
		const parent = this.parent?.() ?? {};
		return {
			...parent,
			latex: latexAttr
		};
	},
	addNodeView() {
		return ({ node, getPos }) => {
			const wrapper = document.createElement('div');
			const innerWrapper = document.createElement('div');
			wrapper.className = 'tiptap-mathematics-render';
			if (this.editor.isEditable) {
				wrapper.classList.add('tiptap-mathematics-render--editable');
			}
			innerWrapper.className = 'block-math-inner';
			const rawLatex = node.attrs.latex ?? '';
			const latex = decodeLatexFromHtml(rawLatex);
			wrapper.dataset.type = 'block-math';
			wrapper.setAttribute('data-latex', rawLatex);
			wrapper.appendChild(innerWrapper);
			const renderMath = () => {
				try {
					katex.render(latex, innerWrapper, { displayMode: true, ...this.options.katexOptions });
					wrapper.classList.remove('block-math-error');
				} catch {
					wrapper.textContent = latex || rawLatex;
					wrapper.classList.add('block-math-error');
				}
			};
			const handleClick = (event: Event) => {
				event.preventDefault();
				event.stopPropagation();
				const pos = getPos();
				if (pos == null) return;
				if (this.options.onClick) this.options.onClick(node, pos);
			};
			if (this.options.onClick) {
				wrapper.addEventListener('click', handleClick);
			}
			renderMath();
			return {
				dom: wrapper,
				destroy() {
					wrapper.removeEventListener('click', handleClick);
				}
			};
		};
	}
});

export const InlineMathWithDecode = InlineMath.extend({
	addAttributes() {
		const parent = this.parent?.() ?? {};
		return {
			...parent,
			latex: latexAttr
		};
	}
});

export { katexOptions };

/**
 * Base extensions without math nodes (math is wired in createEditor so onClick can be injected).
 */
export const baseExtensions = [
	StarterKit.configure({
		orderedList: {
			HTMLAttributes: {
				class: 'list-decimal'
			}
		},
		bulletList: {
			HTMLAttributes: {
				class: 'list-disc'
			}
		},
		heading: {
			levels: [1, 2, 3, 4]
		},
		link: {
			openOnClick: false,
			autolink: true,
			linkOnPaste: true,
			HTMLAttributes: {
				target: '_blank',
				rel: 'noopener noreferrer nofollow'
			}
		},
		codeBlock: false
	}),
	Audio,
	CharacterCount,
	Highlight.configure({
		multicolor: true
	}),
	Placeholder.configure({
		emptyEditorClass: 'is-empty',
		// Use a placeholder:
		// Use different placeholders depending on the node type:
		placeholder: ({ node }) => {
			if (node.type.name === 'heading') {
				return strings.editor.headingPlaceholder;
			}
			if (node.type.name === 'paragraph') {
				return strings.editor.paragraphPlaceholder;
			}
			return '';
		}
	}),
	Color,
	Subscript,
	SuperScript,
	Typography,
	ColorHighlighter,
	TextStyle,
	FontSize,
	TextAlign.configure({
		types: ['heading', 'paragraph']
	}),
	TaskList,
	TaskItem.configure({
		nested: true
	}),
	// SearchAndReplace,
	Table,
	TableHeader,
	TableRow,
	TableCell,
	Markdown
] as Extensions;

/**
 * Contains all the default extensions the editor uses.
 */
export default [
	...baseExtensions,
	BlockMathWithDecode.configure({ katexOptions }),
	InlineMathWithDecode.configure({ katexOptions })
] as Extensions;
