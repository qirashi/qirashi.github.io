const REPO_CONFIG = {
	owner: 'qirashi',
	repo: 'TBGuides',
	branch: 'main'
};

const RAW_BASE = `https://raw.githubusercontent.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/${REPO_CONFIG.branch}/`;
const BLOB_BASE = `https://github.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/blob/${REPO_CONFIG.branch}/`;
const API_BASE = `https://api.github.com/repos/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}`;
const DEFAULT_TITLE = document.title;

const contentEl = document.getElementById('content');
const treeEl = document.getElementById('fileTree');
const mobileQuery = window.matchMedia('(max-width: 768px)');

const fileCache = new Map();
const commitDates = new Map();
let currentPath = null;
let loadToken = 0;

marked.setOptions({ breaks: true, gfm: true });
history.scrollRestoration = 'manual';

function safeDecode(str) {
	try { return decodeURIComponent(str); } catch { return str; }
}

function normalizePath(path) {
	const parts = [];
	for (const part of path.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (!parts.length) return null;
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return parts.length ? parts.join('/') : null;
}

function resolvePath(href, base) {
	const rel = safeDecode(href.split(/[?#]/)[0]);
	const baseDir = rel.startsWith('/') ? '' : base.split('/').slice(0, -1).join('/');
	return normalizePath(`${baseDir}/${rel}`);
}

const isMarkdown = path => /\.md$/i.test(path);
const isExternal = href => /^([a-z][a-z\d+.-]*:|\/\/)/i.test(href);
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const rawUrl = path => RAW_BASE + encodePath(path);

function pageUrl(path, hash = '') {
	const query = path === 'README.md' ? location.pathname : `?file=${encodeURIComponent(path).replace(/%2F/g, '/')}`;
	return hash ? `${query}#${hash}` : query;
}

function pathFromURL() {
	const file = new URLSearchParams(location.search).get('file');
	return file ? normalizePath(file) : 'README.md';
}

function fetchMarkdown(path) {
	if (!fileCache.has(path)) {
		const request = fetch(rawUrl(path)).then(resp => {
			if (!resp.ok) throw new Error(`Файл не найден (${resp.status})`);
			return resp.text();
		});
		request.catch(() => fileCache.delete(path));
		fileCache.set(path, request);
	}
	return fileCache.get(path);
}

function fetchLastModified(path) {
	if (!commitDates.has(path)) {
		const request = fetch(`${API_BASE}/commits?path=${encodeURIComponent(path)}&sha=${REPO_CONFIG.branch}&per_page=1`)
			.then(resp => {
				if (!resp.ok) throw new Error(`GitHub API: ${resp.status}`);
				return resp.json();
			})
			.then(commits => commits[0]?.commit.committer.date ?? null);
		request.catch(() => commitDates.delete(path));
		commitDates.set(path, request);
	}
	return commitDates.get(path);
}

const extractTitle = md => md.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;

async function loadTree() {
	try {
		const text = await fetchMarkdown('README.md');
		const root = { path: 'README.md', name: extractTitle(text) || 'Main Documentation', children: [] };
		const seen = new Set([root.path]);
		const linkRegex = /\[([^\]]+)\]\((?:<([^>]+?\.md)(?:#[^>]*)?>|([^)\s]+?\.md)(?:#[^)\s]*)?)(?:\s+"[^"]*")?\)/gi;

		for (const [, linkText, bracketHref, plainHref] of text.matchAll(linkRegex)) {
			const href = bracketHref ?? plainHref;
			if (isExternal(href)) continue;
			const path = resolvePath(href, 'README.md');
			if (!path || seen.has(path)) continue;
			seen.add(path);
			root.children.push({ path, name: `🔗 ${linkText}`, children: [] });
		}

		const ul = document.createElement('ul');
		ul.className = 'file-tree';
		renderTreeLevel([root], ul);
		treeEl.replaceChildren(ul);
		setActiveFile(currentPath);
	} catch (err) {
		treeEl.innerHTML = '<div class="error">Не удалось загрузить структуру</div>';
	}
}

function renderTreeLevel(nodes, parent) {
	for (const node of nodes) {
		const li = document.createElement('li');
		const item = document.createElement('a');
		item.className = 'tree-item';
		item.href = pageUrl(node.path);
		item.dataset.path = node.path;
		item.textContent = node.name;
		item.addEventListener('click', e => {
			if (isModifiedClick(e)) return;
			e.preventDefault();
			if (mobileQuery.matches) setSidebarOpen(false);
			loadMarkdown(node.path);
		});
		li.appendChild(item);

		if (node.children.length) {
			const ul = document.createElement('ul');
			ul.className = 'tree-children';
			renderTreeLevel(node.children, ul);
			li.appendChild(ul);
		}
		parent.appendChild(li);
	}
}

function setActiveFile(path) {
	document.querySelectorAll('.tree-item').forEach(item => {
		const active = item.dataset.path === path;
		item.classList.toggle('active', active);
		if (active) item.setAttribute('aria-current', 'page');
		else item.removeAttribute('aria-current');
	});
}

async function loadMarkdown(path, { push = true, hash = '', scrollY = null } = {}) {
	const token = ++loadToken;

	if (!path || !isMarkdown(path)) {
		showError('Некорректный путь к файлу');
		return;
	}

	if (push) {
		history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
		history.pushState({ filePath: path }, '', pageUrl(path, hash));
	}

	contentEl.innerHTML = '<div class="loading"><span class="spinner"></span>Загрузка...</div>';

	try {
		const text = await fetchMarkdown(path);
		if (token !== loadToken) return;

		currentPath = path;
		displayMarkdown(text, path);
		setActiveFile(path);

		if (!scrollToId(hash, 'auto')) window.scrollTo(0, scrollY || 0);
	} catch (err) {
		if (token === loadToken) showError(err.message);
	}
}

function showError(message) {
	currentPath = null;
	document.title = DEFAULT_TITLE;
	contentEl.innerHTML = '<div class="error"><strong>Ошибка:</strong><br><span></span></div>';
	contentEl.querySelector('.error span').textContent = message;
	setActiveFile(null);
}

function displayMarkdown(text, file) {
	contentEl.innerHTML = DOMPurify.sanitize(marked.parse(text));

	renderAlerts(contentEl);
	addHeadingIds(contentEl);
	const h1 = contentEl.querySelector('h1');
	document.title = h1 ? `${h1.textContent.trim()} — ${DEFAULT_TITLE}` : DEFAULT_TITLE;

	fixLinks(contentEl, file);
	fixImages(contentEl, file);
	addAnchorLinks(contentEl);
	enhanceCodeBlocks(contentEl);
	renderFileMeta(file);
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6';
const legacySlug = text => text.toLowerCase().replace(/[^\wЀ-ӿ]+/g, '-').replace(/^-+|-+$/g, '');

function findHeading(id) {
	return contentEl.querySelector(`#${CSS.escape(id)}`)
		|| [...contentEl.querySelectorAll(HEADINGS)].find(h => legacySlug(h.textContent) === id);
}

function scrollToId(id, behavior = 'smooth') {
	if (!id) return false;
	const target = findHeading(safeDecode(id));
	target?.scrollIntoView({ behavior, block: 'start' });
	return !!target;
}

function addHeadingIds(container) {
	const used = new Map();
	container.querySelectorAll(HEADINGS).forEach(h => {
		if (h.id) return;
		const slug = h.textContent.trim().toLowerCase()
			.replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
			.replace(/\s/g, '-');
		if (!slug) return;
		const count = used.get(slug) || 0;
		used.set(slug, count + 1);
		h.id = count ? `${slug}-${count}` : slug;
	});
}

function fixImages(container, file) {
	container.querySelectorAll('img[src]').forEach(img => {
		img.loading = 'lazy';
		const src = img.getAttribute('src');
		if (isExternal(src) || src.startsWith('data:')) return;
		const path = resolvePath(src, file);
		if (path) img.src = rawUrl(path);
	});
}

const isModifiedClick = e => e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;

function fixLinks(container, file) {
	container.querySelectorAll('a[href]').forEach(link => {
		const href = link.getAttribute('href');

		if (href.startsWith('#')) {
			link.addEventListener('click', e => {
				e.preventDefault();
				if (scrollToId(href.slice(1))) history.pushState({ filePath: currentPath }, '', href);
			});
			return;
		}
		if (isExternal(href)) return;

		const path = resolvePath(href, file);
		if (!path) return;

		if (!isMarkdown(path)) {
			link.href = BLOB_BASE + encodePath(path);
			link.target = '_blank';
			link.rel = 'noopener';
			return;
		}

		const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
		link.classList.add('md-link');
		link.href = pageUrl(path, hash);
		link.addEventListener('click', e => {
			if (isModifiedClick(e)) return;
			e.preventDefault();
			loadMarkdown(path, { hash });
		});
	});
}

const svgIcon = (path, className = '') =>
	`<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${path}"/></svg>`;

const ALERTS = {
	note:      { title: 'Заметка',        icon: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z' },
	tip:       { title: 'Совет',          icon: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z' },
	important: { title: 'Важно',          icon: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z' },
	warning:   { title: 'Внимание',       icon: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z' },
	caution:   { title: 'Предупреждение', icon: 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z' }
};

function renderAlerts(container) {
	container.querySelectorAll('blockquote').forEach(quote => {
		const first = quote.firstElementChild;
		if (first?.tagName !== 'P') return;
		const match = first.innerHTML.match(/^\s*\[!(note|tip|important|warning|caution)\]\s*(<br>\s*)?/i);
		if (!match) return;

		const type = match[1].toLowerCase();
		const { title, icon } = ALERTS[type];
		first.innerHTML = first.innerHTML.slice(match[0].length);
		if (!first.innerHTML.trim()) first.remove();

		const alert = document.createElement('div');
		alert.className = `markdown-alert markdown-alert-${type}`;
		alert.innerHTML = `<p class="markdown-alert-title">${svgIcon(icon, 'octicon')}${title}</p>`;
		alert.append(...quote.childNodes);
		quote.replaceWith(alert);
	});
}

const ANCHOR_ICON = 'm7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z';
const COPY_ICON = 'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Zm5-5C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z';
const CHECK_ICON = 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z';

function copyWithFeedback(button, text) {
	navigator.clipboard?.writeText(text)
		.then(() => {
			button.classList.add('copied');
			setTimeout(() => button.classList.remove('copied'), 1500);
		})
		.catch(err => console.error('Не удалось скопировать', err));
}

function addAnchorLinks(container) {
	container.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]').forEach(h => {
		const link = document.createElement('a');
		link.className = 'anchor-link';
		link.href = pageUrl(currentPath, h.id);
		link.title = 'Скопировать ссылку на заголовок';
		link.setAttribute('aria-label', link.title);
		link.innerHTML = svgIcon(ANCHOR_ICON);

		link.addEventListener('click', e => {
			e.preventDefault();
			history.replaceState(history.state, '', link.href);
			copyWithFeedback(link, location.href);
		});

		h.appendChild(link);
	});
}

function enhanceCodeBlocks(container) {
	container.querySelectorAll('pre').forEach(pre => {
		const code = pre.querySelector('code');
		const lang = code?.className.match(/language-([\w+-]+)/)?.[1];
		if (lang && window.hljs?.getLanguage(lang)) hljs.highlightElement(code);

		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'copy-btn';
		button.title = 'Копировать';
		button.setAttribute('aria-label', button.title);
		button.innerHTML = svgIcon(COPY_ICON, 'icon-copy') + svgIcon(CHECK_ICON, 'icon-check');
		button.addEventListener('click', () => copyWithFeedback(button, pre.textContent));

		const wrapper = document.createElement('div');
		wrapper.className = 'code-block';
		pre.replaceWith(wrapper);
		wrapper.append(pre, button);
	});
}

function renderFileMeta(path) {
	const footer = document.createElement('footer');
	footer.className = 'file-meta';
	footer.innerHTML = '<span class="file-meta-date"></span><a target="_blank" rel="noopener">Открыть на GitHub</a>';
	footer.querySelector('a').href = BLOB_BASE + encodePath(path);
	contentEl.appendChild(footer);

	fetchLastModified(path)
		.then(date => {
			if (!date || !footer.isConnected) return;
			const formatted = new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
			footer.querySelector('.file-meta-date').textContent = `Обновлено ${formatted}`;
		})
		.catch(() => {});
}

let desktopHidden = false;
let mobileOpen = false;
try { desktopHidden = localStorage.getItem('sidebarHidden') === 'true'; } catch {}

function updateSidebar() {
	const mobile = mobileQuery.matches;
	document.body.classList.toggle('sidebar-open', mobile && mobileOpen);
	document.body.classList.toggle('sidebar-hidden', !mobile && desktopHidden);
}

function setSidebarOpen(open) {
	if (mobileQuery.matches) {
		mobileOpen = open;
	} else {
		desktopHidden = !open;
		try { localStorage.setItem('sidebarHidden', desktopHidden); } catch {}
	}
	updateSidebar();
}

const isSidebarOpen = () => mobileQuery.matches ? mobileOpen : !desktopHidden;
const toggleSidebar = () => setSidebarOpen(!isSidebarOpen());

updateSidebar();
mobileQuery.addEventListener('change', updateSidebar);
document.getElementById('sidebarOpenBtn').addEventListener('click', toggleSidebar);
document.getElementById('sidebarCloseBtn').addEventListener('click', toggleSidebar);
document.getElementById('sidebarOverlay').addEventListener('click', () => setSidebarOpen(false));
document.addEventListener('keydown', e => {
	if (e.key === 'Escape' && mobileQuery.matches && mobileOpen) setSidebarOpen(false);
});

window.addEventListener('popstate', e => {
	const path = e.state?.filePath ?? pathFromURL();
	const hash = location.hash.slice(1);
	if (path === currentPath) {
		if (!scrollToId(hash)) window.scrollTo(0, e.state?.scrollY || 0);
	} else {
		loadMarkdown(path, { push: false, hash, scrollY: e.state?.scrollY });
	}
});

window.addEventListener('pagehide', () => {
	history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
});

const initialScroll = history.state?.scrollY;
history.replaceState({ ...history.state, filePath: pathFromURL() }, '');
loadTree();
loadMarkdown(pathFromURL(), { push: false, hash: location.hash.slice(1), scrollY: initialScroll });

const SEASONS = [
	{
		name: 'winter',
		isActive: month => month === 11 || month <= 1,
		symbols: ['❄', '❅', '❆', '✻'],
		size: [0.5, 2],
		spin: [360, 360],
		interval: 300
	},
	{
		name: 'halloween',
		isActive: (month, day) => (month === 9 && day >= 24) || (month === 10 && day === 1),
		symbols: ['🦇', '🎃', '🕸️', '🍂', '🍂'],
		icon: '🎃',
		size: [1, 2],
		spin: [-60, 60],
		interval: 900
	}
];

const random = (min, max) => Math.random() * (max - min) + min;

function initSeason(season) {
	document.body.classList.add(`season-${season.name}`);
	if (season.icon) {
		const title = document.getElementById('repoTitle');
		title.textContent = title.textContent.replace('📃', season.icon);
	}
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

	const container = document.getElementById('particles');
	const interval = season.interval * (mobileQuery.matches ? 2 : 1);

	function createParticle() {
		if (document.hidden) return;
		const particle = document.createElement('div');
		particle.className = 'particle';
		particle.textContent = season.symbols[Math.floor(Math.random() * season.symbols.length)];
		particle.style.left = `${random(0, 100)}%`;
		particle.style.fontSize = `${random(...season.size)}em`;
		particle.style.animationDuration = `${random(10, 25)}s`;
		particle.style.setProperty('--drift', `${random(-50, 50)}px`);
		particle.style.setProperty('--spin', `${random(...season.spin)}deg`);
		particle.style.setProperty('--opacity', random(0.3, 0.7));
		particle.addEventListener('animationend', () => particle.remove());
		container.appendChild(particle);
	}

	setInterval(createParticle, interval);
	for (let i = 0; i < Math.ceil(4500 / season.interval); i++) setTimeout(createParticle, i * 200);
}

const today = new Date();
const season = SEASONS.find(s => s.isActive(today.getMonth(), today.getDate()));
if (season) initSeason(season);
