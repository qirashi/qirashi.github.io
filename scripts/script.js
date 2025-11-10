// Конфигурация репозитория
const REPO_CONFIG = {
	owner: 'qirashi',
	repo: 'TBGuides',
	branch: 'main'
};

// Кэш и дерево файлов
const fileCache = new Map();
const fileTree = {};

// Настройка Marked
marked.setOptions({ breaks: true, gfm: true });

// Сайдбар
let isSidebarHidden = JSON.parse(localStorage.getItem('sidebarHidden') || 'false');

function updateSidebar() {
	const sidebar = document.getElementById('sidebar');
	const openBtn = document.getElementById('sidebarOpenBtn');
	const overlay = document.getElementById('sidebarOverlay');
	sidebar.classList.toggle('hidden', isSidebarHidden);
	openBtn.style.display = isSidebarHidden ? 'flex' : 'none';
	overlay.classList.toggle('visible', !isSidebarHidden && window.innerWidth <= 768);
	localStorage.setItem('sidebarHidden', isSidebarHidden);
}

function toggleSidebar() {
	isSidebarHidden = !isSidebarHidden;
	updateSidebar();
}

// Обновление URL и истории браузера
function updateURL(filePath) {
	const basePath = window.location.origin + window.location.pathname;
	const newURL = filePath === 'README.md' ? basePath : `${basePath}?file=${encodeURIComponent(filePath)}`;
	window.history.pushState({ filePath }, '', newURL);
}

// Извлечение заголовка
const extractTitle = md => (md.match(/^#\s+(.+)$/m)?.[1]?.trim() || null);

// Добавление файла в дерево
function addFile(filePath, title = null) {
	if (!fileTree[filePath]) {
		const rawName = filePath.split('/').pop().replace('.md', '');
		const displayName = title || rawName.replace(/[_-]/g, ' ');
		fileTree[filePath] = { type: 'file', path: filePath, name: displayName, children: {} };
	}
	return fileTree[filePath];
}

// Создание дерева из README
function buildTreeFromReadme(text) {
	const title = extractTitle(text) || 'TBGuides';
	const root = addFile('README.md', title);
	const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
	let match;
	while ((match = linkRegex.exec(text)) !== null) {
		const [, linkText, linkPath] = match;
		const fullPath = resolvePath(linkPath, 'README.md');
		const node = addFile(fullPath, `📘 ${linkText}`);
		root.children[fullPath] = true;
	}
}

// Отрисовка дерева
function renderTree() {
	const rootContainer = document.getElementById('fileTree');
	rootContainer.innerHTML = '<ul class="file-tree" id="mainTree"></ul>';
	renderTreeLevel({ 'README.md': true }, document.getElementById('mainTree'));
}

function renderTreeLevel(level, parent) {
	Object.keys(level).forEach(filePath => {
		const file = fileTree[filePath];
		if (!file) return;
		const li = document.createElement('li');
		li.innerHTML = `<div class="tree-item file" data-path="${file.path}"><span>${file.name}</span></div>`;
		li.querySelector('.tree-item').onclick = () => loadMarkdown(file.path);
		if (Object.keys(file.children).length) {
			const ul = document.createElement('ul');
			ul.className = 'tree-children';
			renderTreeLevel(file.children, ul);
			li.appendChild(ul);
		}
		parent.appendChild(li);
	});
}

// ===== УБРАЛИ ДУБЛИРОВАНИЕ =====

// Загрузка README один раз
async function ensureReadmeLoaded() {
	if (fileCache.has('README.md')) return;

	try {
		const readmeURL = `https://raw.githubusercontent.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/${REPO_CONFIG.branch}/README.md`;
		const resp = await fetch(readmeURL);
		if (!resp.ok) return;
		const text = await resp.text();
		fileCache.set('README.md', { content: text, title: extractTitle(text) });
		buildTreeFromReadme(text);
	} catch (e) {
		console.error('Ошибка при загрузке README:', e);
	}
}

// Унифицированный вывод загруженного файла
function applyLoadedMarkdown(clean, text, fromHistory = false) {
	const title = extractTitle(text);
	fileCache.set(clean, { content: text, title });

	renderTree();
	setActiveFile(clean);
	displayMarkdown(text, clean);

	if (!fromHistory) updateURL(clean);
}

// ===== ГЛАВНАЯ ФУНКЦИЯ ЗАГРУЗКИ =====
async function loadMarkdown(filePath, parentPath = null, fromHistory = false) {
	const content = document.getElementById('content');
	content.innerHTML = '<div class="loading"><span class="spinner"></span>Загрузка...</div>';
	const clean = filePath.replace(/^\//, '');

	await ensureReadmeLoaded();

	if (fileCache.has(clean)) {
		return applyLoadedMarkdown(clean, fileCache.get(clean).content, fromHistory);
	}

	try {
		const url = `https://raw.githubusercontent.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/${REPO_CONFIG.branch}/${clean}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Файл не найден (${response.status})`);

		const text = await response.text();
		if (clean !== 'README.md') addFile(clean, extractTitle(text));

		applyLoadedMarkdown(clean, text, fromHistory);
	} catch (err) {
		content.innerHTML = `<div class="error"><strong>Ошибка:</strong><br>${err.message}</div>`;
	}
}

// Разрешение относительных путей
function resolvePath(rel, base) {
	const baseDir = base.split('/').slice(0, -1).join('/');
	return rel.startsWith('./') ? `${baseDir}/${rel.slice(2)}` :
		   rel.startsWith('../') ? baseDir.split('/').slice(0, -1).join('/') + '/' + rel.replace(/^..\//, '') :
		   rel.startsWith('/') ? rel.slice(1) : baseDir ? baseDir + '/' + rel : rel;
}

// Помощники отображения
function fixHeadings(container) {
	container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
		if (!h.id) h.id = h.textContent.toLowerCase().replace(/[^\w\u0400-\u04FF]+/g, '-').replace(/^-+|-+$/g, '');
	});
}

function fixImages(container, file) {
	container.querySelectorAll('img').forEach(img => {
		const src = img.getAttribute('src');
		if (src && !/^(http|data)/.test(src))
			img.src = `https://raw.githubusercontent.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/${REPO_CONFIG.branch}/${resolvePath(src, file)}`;
	});
}

function fixLinks(container, file) {
	container.querySelectorAll('a').forEach(link => {
		const href = link.getAttribute('href');
		if (!href || href.startsWith('http') || href.startsWith('javascript:')) return;
		if (href.startsWith('#')) {
			link.onclick = e => {
				e.preventDefault();
				const hash = decodeURIComponent(href);
				const target = document.querySelector(hash);
				if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
			};
			return;
		}
		link.classList.add('md-link');
		link.href = 'javascript:void(0);';
		link.onclick = e => { e.preventDefault(); loadMarkdown(resolvePath(href, file), file); };
	});
}

// Обработка спец-блоков
function preprocessSpecialBlocks(markdownText) {
	const blocks = {
		NOTE:      { cls: 'markdown-alert-note',      title: 'Заметка',       icon: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z' },
		TIP:       { cls: 'markdown-alert-tip',       title: 'Совет',         icon: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z' },
		IMPORTANT: { cls: 'markdown-alert-important', title: 'Важно',         icon: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z' },
		WARNING:   { cls: 'markdown-alert-warning',   title: 'Внимание',      icon: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z' },
		CAUTION:   { cls: 'markdown-alert-caution',   title: 'Предупреждение',icon: 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z' }
	};

	for (const type in blocks) {
		const block = blocks[type];
		markdownText = markdownText.replace(
			new RegExp(`(^|\\n)>?\\s*\\[!${type}\\]\\s*\\n((?:>.*\\n?)*)`, 'gi'),
			(_, p, body) => {
				body = body.replace(/^> ?/gm, '').trim();
				const inner = marked.parse(body).replace(/^<p>|<\/p>\n?$/g, '');
				return `${p}<div class="markdown-alert ${block.cls}">
	<div class="markdown-alert-title">
		<svg viewBox="0 0 16 16" width="16" height="16"><path d="${block.icon}"/></svg> ${block.title}
	</div>
	${inner}
</div>\n`;
			}
		);
	}

	return markdownText;
}

function addAnchorLinks(container) {
    const svgPath = 'm7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z';

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');

    headings.forEach(h => {
        if (!h.id || h.querySelector('.anchor-link')) return;

        const link = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        link.classList.add('anchor-link');
        link.setAttribute('viewBox', '0 0 16 16');
        link.setAttribute('width', '16');
        link.setAttribute('height', '16');
        link.innerHTML = `<path d="${svgPath}"></path>`;
        link.title = 'Скопировать ссылку на заголовок';

        link.addEventListener('click', e => {
            e.stopPropagation();
            const currentFile = new URLSearchParams(window.location.search).get('file') || 'README.md';
            const url = `${location.origin}${location.pathname}?file=${encodeURIComponent(currentFile)}#${h.id}`;

            navigator.clipboard.writeText(url)
                .then(() => {
                    link.classList.add('copied');
                    setTimeout(() => link.classList.remove('copied'), 800);
                })
                .catch(err => console.error('Не удалось скопировать ссылку', err));
        });

        h.appendChild(link);
    });
}

function displayMarkdown(text, file) {
	const html = marked.parse(preprocessSpecialBlocks(text));
	const container = document.getElementById('content');
	container.innerHTML = html;

	fixHeadings(container);
	addAnchorLinks(container);
	fixLinks(container, file);
	fixImages(container, file);

	if (location.hash) {
		const hash = decodeURIComponent(location.hash);
		setTimeout(() => {
			const target = document.querySelector(hash);
			if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}, 100);
	}
}

// Активный файл
function setActiveFile(path) {
	document.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
	document.querySelector(`.tree-item[data-path="${path}"]`)?.classList.add('active');
}

// Загрузка из URL
function loadFromURL() {
	const params = new URLSearchParams(window.location.search);
	const file = params.get('file');
	if (file) return loadMarkdown(decodeURIComponent(file));
	return loadMarkdown('README.md');
}

// История браузера
function handlePopState(event) {
	if (event.state && event.state.filePath) {
		loadMarkdown(event.state.filePath, null, true);
	} else {
		loadFromURL();
	}
}

function initHistoryState() {
	const params = new URLSearchParams(window.location.search);
	const file = params.get('file') ? decodeURIComponent(params.get('file')) : 'README.md';
	if (!history.state || history.state.filePath !== file) {
		window.history.replaceState({ filePath: file }, '', window.location.href);
	}
}

// Init
document.addEventListener('DOMContentLoaded', () => {
	updateSidebar();
	document.getElementById('sidebarOpenBtn').onclick = toggleSidebar;
	document.getElementById('sidebarCloseBtn').onclick = toggleSidebar;
	document.getElementById('sidebarOverlay').onclick = toggleSidebar;

	initHistoryState();
	window.addEventListener('popstate', handlePopState);
	loadFromURL();
});

window.addEventListener('resize', updateSidebar);
window.loadMarkdownFile = loadMarkdown;
