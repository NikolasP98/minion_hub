import createDOMPurify from 'dompurify';
import { Editor, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { DOMSerializer } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';

export const DEPENDENCY_CHECKS = [
  'prototype attributes',
  'editor paste and Markdown',
  'ordinary sanitizer',
  'detached sanitizer subtree',
] as const;

export type DependencyCheck = (typeof DEPENDENCY_CHECKS)[number];

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function requireMarkdownStorage(storage: unknown): MarkdownStorage {
  assert(typeof storage === 'object' && storage !== null, 'editor storage is missing');
  assert('markdown' in storage, 'Markdown extension storage is missing');
  const markdown = storage.markdown;
  assert(typeof markdown === 'object' && markdown !== null, 'Markdown storage is invalid');
  assert('getMarkdown' in markdown, 'Markdown serializer is missing');
  assert(typeof markdown.getMarkdown === 'function', 'Markdown serializer is invalid');
  return markdown as MarkdownStorage;
}

const checks: Record<DependencyCheck, () => void> = {
  'prototype attributes': () => {
    const attributes = mergeAttributes(
      JSON.parse('{"__proto__":{"onerror":"synthetic()","data-probe":"inherited"}}'),
    );
    const image = DOMSerializer.renderSpec(document, ['img', attributes]).dom;
    assert(image instanceof HTMLElement, 'image was not an element');
    assert(
      !image.hasAttribute('onerror') && !image.hasAttribute('data-probe'),
      'inherited executable attributes',
    );
  },
  'editor paste and Markdown': () => {
    const element = document.querySelector<HTMLElement>('#editor');
    assert(element, 'editor mount is missing');
    const editor = new Editor({
      element,
      extensions: [
        StarterKit,
        Highlight,
        Image.configure({ allowBase64: false }),
        Markdown.configure({
          html: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      content: '## Fixture\n\n**bold** and _italic_',
    });
    try {
      assert(editor.getHTML().includes('<strong>bold</strong>'), 'bold roundtrip');
      editor.view.pasteHTML(
        '<p onclick="synthetic()">safe <img onerror="synthetic()"></p><script>synthetic()</script>',
      );
      const rendered = document.createElement('div');
      rendered.innerHTML = editor.getHTML();
      assert(!rendered.querySelector('script,[onerror],[onclick]'), 'unsafe paste');
      const markdown = requireMarkdownStorage(editor.storage).getMarkdown();
      assert(markdown.includes('**bold**'), 'Markdown serialization');
      editor.commands.setContent(markdown);
      assert(editor.getText().includes('Fixture'), 'Markdown reload');
    } finally {
      editor.destroy();
    }
  },
  'ordinary sanitizer': () => {
    const purify = createDOMPurify(window);
    const clean = purify.sanitize(
      '<p><strong>safe</strong><img onerror="synthetic()"><script>synthetic()</script><a href="javascript:synthetic()">link</a></p>',
    );
    assert(!/onerror|javascript:|<script/.test(clean), 'executable HTML');
    assert(clean.includes('<strong>safe</strong>'), 'formatting lost');
  },
  'detached sanitizer subtree': () => {
    const purify = createDOMPurify(window);
    const root = document.createElement('div');
    root.innerHTML = '<footer><img onload="synthetic()"></footer><div>safe</div>';
    const image = root.querySelector('img');
    assert(image, 'fixture image is missing');
    purify.addHook('uponSanitizeElement', (node) => {
      if (node.nodeName === 'FOOTER') node.parentNode?.removeChild(node);
    });
    purify.sanitize(root, { IN_PLACE: true, ALLOWED_TAGS: ['div', 'footer', '#text'] });
    assert(!image.hasAttribute('onload'), 'detached handler retained');
  },
};

type DependencySecurityApi = {
  names: readonly DependencyCheck[];
  run(name: DependencyCheck): { name: DependencyCheck; passed: true };
};

declare global {
  interface Window {
    __dependencySecurity: DependencySecurityApi;
  }
}

window.__dependencySecurity = {
  names: DEPENDENCY_CHECKS,
  run(name) {
    const check = checks[name];
    if (!check) throw new Error(`Unknown dependency check: ${String(name)}`);
    check();
    const result = document.querySelector<HTMLOutputElement>('#result');
    if (result) result.value = `passed: ${name}`;
    return { name, passed: true };
  },
};
