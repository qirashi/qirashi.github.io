// Конфигурация репозитория
const REPO_CONFIG = {
	owner: 'qirashi',
	repo: 'TBGuides',
	branch: 'main'
};

// Кэш для файлов и структура дерева
const fileCache = new Map();
const fileTree = {
	'README.md': { 
		type: 'file', 
		path: 'README.md', 
		name: 'README',
		title: 'Загрузка...',
		children: {} 
	}
};

// Настройка Marked
marked.setOptions({
	breaks: true,
	gfm: true
});

// Управление сайдбаром
let isSidebarHidden = false;

function toggleSidebar() {
	isSidebarHidden = !isSidebarHidden;
	updateSidebarState();
}

function updateSidebarState() {
	const sidebar = document.getElementById('sidebar');
	const openBtn = document.getElementById('sidebarOpenBtn');
	const overlay = document.getElementById('sidebarOverlay');
	
	if (isSidebarHidden) {
		// Скрываем сайдбар
		sidebar.classList.add('hidden');
		openBtn.style.display = 'flex';
		overlay.classList.remove('visible');
	} else {
		// Показываем сайдбар
		sidebar.classList.remove('hidden');
		openBtn.style.display = 'none';
		if (window.innerWidth <= 768) {
			overlay.classList.add('visible');
		}
	}
	
	// Сохраняем состояние в localStorage
	localStorage.setItem('sidebarHidden', isSidebarHidden);
}

function initSidebarState() {
	const savedState = localStorage.getItem('sidebarHidden');
	const openBtn = document.getElementById('sidebarOpenBtn');
	
	if (savedState === 'true') {
		isSidebarHidden = true;
		openBtn.style.display = 'flex';
	} else {
		isSidebarHidden = false;
		openBtn.style.display = 'none';
	}
	updateSidebarState();
}

// Единая функция для извлечения заголовка из Markdown контента
function extractTitleFromMarkdown(content) {
	const titleMatch = content.match(/^#\s+(.+)$/m);
	return titleMatch ? titleMatch[1].trim() : null;
}

// Единая функция для обновления всех заголовков
function updateTitles(title) {
	if (!title) return;
	
	// Обновляем заголовок страницы
	document.title = title;
	
	// Обновляем заголовок в сайдбаре
	document.getElementById('repoTitle').textContent = title;
	
	// Обновляем заголовок README в дереве
	if (fileTree['README.md']) {
		fileTree['README.md'].title = title;
	}
}

// Простая функция для добавления файла в дерево
function addFileToTree(filePath, parentPath = null, title = null) {
	// Если файл уже есть в дереве, только обновляем связь с родителем
	if (fileTree[filePath]) {
		if (parentPath && fileTree[parentPath] && !fileTree[parentPath].children[filePath]) {
			fileTree[parentPath].children[filePath] = true;
		}
		return fileTree[filePath];
	}
	
	// Создаем запись о файле
	const fileName = filePath.split('/').pop().replace('.md', '');
	const displayName = fileName.replace(/_/g, ' ').replace(/-/g, ' ');
	const formattedName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
	
	fileTree[filePath] = { 
		type: 'file', 
		path: filePath,
		name: formattedName,
		title: title || formattedName,
		children: {}
	};
	
	// Если указан родитель, добавляем связь
	if (parentPath && fileTree[parentPath]) {
		fileTree[parentPath].children[filePath] = true;
	}
	
	return fileTree[filePath];
}

// Функция для отрисовки дерева
function renderFileTree() {
	const treeContainer = document.getElementById('fileTree');
	treeContainer.innerHTML = '<ul class="file-tree" id="mainTree"></ul>';
	const mainTree = document.getElementById('mainTree');
	
	// Рекурсивно отрисовываем дерево, начиная с корневых элементов
	renderTreeLevel(fileTree, mainTree, true);
}

// Рекурсивная функция отрисовки уровня дерева
function renderTreeLevel(level, parentElement, isRoot = false) {
	// Собираем все элементы для отображения
	const itemsToRender = [];
	
	if (isRoot) {
		// В корне показываем только README и его детей
		if (level['README.md']) {
			itemsToRender.push('README.md');
		}
	} else {
		// В остальных уровнях показываем все элементы
		Object.keys(level).forEach(filePath => {
			if (fileTree[filePath]) {
				itemsToRender.push(filePath);
			}
		});
	}
	
	// Отрисовываем элементы
	itemsToRender.forEach(filePath => {
		const item = fileTree[filePath];
		const li = document.createElement('li');
		
		const displayTitle = item.title || item.name;
		
		li.innerHTML = `
			<div class="tree-item file" data-path="${item.path}">
				<span>${displayTitle}</span>
			</div>
		`;
		
		li.querySelector('.tree-item').addEventListener('click', (e) => {
			e.stopPropagation();
			loadMarkdownFile(item.path);
		});
		
		// Если у файла есть дети, добавляем их
		if (Object.keys(item.children).length > 0) {
			const childrenUl = document.createElement('ul');
			childrenUl.className = 'tree-children';
			li.appendChild(childrenUl);
			
			// Создаем подуровень с детьми этого файла
			const childLevel = {};
			Object.keys(item.children).forEach(childPath => {
				if (fileTree[childPath]) {
					childLevel[childPath] = true;
				}
			});
			renderTreeLevel(childLevel, childrenUl);
		}
		
		parentElement.appendChild(li);
	});
}

// Основная функция загрузки MD файла
async function loadMarkdownFile(filePath, parentPath = null) {
	const contentDiv = document.getElementById('content');
	
	contentDiv.innerHTML = '<div class="loading"><span class="spinner"></span>Загрузка...</div>';
	updateActiveFile(filePath);
	
	try {
		const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
		
		// Если файл уже в кэше, просто отображаем его
		if (fileCache.has(cleanPath)) {
			const cachedFile = fileCache.get(cleanPath);
			displayMarkdown(cachedFile.content, cleanPath);
			
			// Сохраняем текущий hash если он есть
			const currentHash = window.location.hash;
			if (currentHash) {
				window.location.hash = currentHash;
			}
			return;
		}

		// Загружаем файл
		const rawUrl = `https://raw.githubusercontent.com/${REPO_CONFIG.owner}/${REPO_CONFIG.repo}/${REPO_CONFIG.branch}/${cleanPath}`;
		const response = await fetch(rawUrl);
		
		if (!response.ok) {
			throw new Error(`Файл не найден: ${response.status}`);
		}
		
		const markdownText = await response.text();
		
		// Извлекаем заголовок из содержимого
		const title = extractTitleFromMarkdown(markdownText);
		
		// Сохраняем в кэш
		fileCache.set(cleanPath, {
			content: markdownText,
			parent: parentPath,
			title: title
		});
		
		// Добавляем/обновляем файл в дереве
		addFileToTree(cleanPath, parentPath, title);
		
		// Обновляем заголовки для README
		if (cleanPath === 'README.md' && title) {
			updateTitles(title);
		}
		
		// Перерисовываем дерево
		renderFileTree();
		updateActiveFile(cleanPath);
		
		displayMarkdown(markdownText, cleanPath);
		
	} catch (error) {
		contentDiv.innerHTML = `
			<div class="error">
				<strong>Ошибка загрузки файла:</strong><br>
				${error.message}<br>
				Путь: ${filePath}
			</div>
		`;
	}
}

// Функция разрешения относительных путей
function resolveRelativePath(relativePath, baseFilePath) {
	const baseDir = baseFilePath.split('/').slice(0, -1).join('/');
	
	if (relativePath.startsWith('./')) {
		return baseDir + '/' + relativePath.substring(2);
	} else if (relativePath.startsWith('../')) {
		let currentDir = baseDir;
		let path = relativePath;
		
		while (path.startsWith('../')) {
			currentDir = currentDir.split('/').slice(0, -1).join('/');
			path = path.substring(3);
		}
		return currentDir + '/' + path;
	} else if (relativePath.startsWith('/')) {
		return relativePath.substring(1);
	} else {
		return baseDir ? baseDir + '/' + relativePath : relativePath;
	}
}

// Функция для обработки заголовков и добавления ID
function processHeadings(container) {
	const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
	
	headings.forEach(heading => {
		if (!heading.id) {
			// Создаем ID из текста заголовка (аналогично тому, как это делает GitHub)
			const id = heading.textContent
				.toLowerCase()
				.replace(/[^\w\u0400-\u04FF]+/g, '-')
				.replace(/^-+|-+$/g, '');
			heading.id = id;
		}
	});
}

// Функция отображения Markdown
function displayMarkdown(markdownText, currentFilePath) {
	const contentDiv = document.getElementById('content');
	
	let processedMarkdown = preprocessSpecialBlocks(markdownText);
	const htmlContent = marked.parse(processedMarkdown);
	contentDiv.innerHTML = htmlContent;
	
	// Обрабатываем заголовки для якорных ссылок
	processHeadings(contentDiv);
	
	processLinksInContent(contentDiv, currentFilePath);
	
	// Если в URL есть якорь, прокручиваем к нему
	setTimeout(() => {
		const hash = window.location.hash;
		if (hash) {
			const target = document.querySelector(hash);
			if (target) {
				target.scrollIntoView({ behavior: 'smooth' });
			}
		}
	}, 100);
}

// Обработка специальных блоков
function preprocessSpecialBlocks(markdownText) {
	const blocks = {
		NOTE:      { cls: 'markdown-alert-note',      title: 'Заметка',       icon: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z' },
		TIP:       { cls: 'markdown-alert-tip',       title: 'Совет',         icon: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z' },
		IMPORTANT: { cls: 'markdown-alert-important', title: 'Важно',         icon: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z' },
		WARNING:   { cls: 'markdown-alert-warning',   title: 'Внимание',      icon: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z' },
		CAUTION:   { cls: 'markdown-alert-caution',   title: 'Предупреждение',icon: 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z' }
	};

	for (const type in blocks) {
		const { cls, title, icon } = blocks[type];

		const re = new RegExp(
			String.raw`(^|\n)>?\s*\[\!${type}\]\s*\n((?:>.*\n?)*)`,
			'gi'
		);

		markdownText = markdownText.replace(re, (match, prefix, content) => {
			content = content.replace(/^> ?/gm, '').trim();

			let htmlContent = marked.parse(content);

			if (htmlContent.startsWith('<p>') && htmlContent.endsWith('</p>\n')) {
				htmlContent = htmlContent.slice(3, -5);
			}

			return `${prefix}<div class="markdown-alert ${cls}">
	<div class="markdown-alert-title">
		<svg viewBox="0 0 16 16" width="16" height="16">
			<path d="${icon}"></path>
		</svg> ${title}
	</div>
	${htmlContent}
</div>\n`;
		});
	}

	return markdownText;
}


// Обработка ссылок в контенте
function processLinksInContent(container, currentFilePath) {
	const links = container.getElementsByTagName('a');
	
	for (let link of links) {
		const href = link.getAttribute('href');
		
		if (href && !href.startsWith('http') && !href.startsWith('javascript:')) {
			if (href.startsWith('#')) {
				// Якорная ссылка - оставляем стандартное поведение
				link.classList.add('md-link');
				// Не переопределяем поведение, чтобы браузер сам обрабатывал скролл
			} else {
				// Обычная ссылка на другой MD файл
				link.classList.add('md-link');
				link.onclick = (e) => {
					e.preventDefault();
					const resolvedPath = resolveRelativePath(href, currentFilePath);
					loadMarkdownFile(resolvedPath, currentFilePath);
				};
				link.href = 'javascript:void(0);';
			}
		}
	}
}

// Обновление активного файла в дереве
function updateActiveFile(filePath) {
	document.querySelectorAll('.tree-item').forEach(item => {
		item.classList.remove('active');
	});
	
	const activeItem = document.querySelector(`.tree-item[data-path="${filePath}"]`);
	if (activeItem) {
		activeItem.classList.add('active');
	}
}

// Обработчик изменения hash в URL
window.addEventListener('hashchange', function() {
	const hash = window.location.hash;
	if (hash) {
		const target = document.querySelector(hash);
		if (target) {
			setTimeout(() => {
				target.scrollIntoView({ behavior: 'smooth' });
			}, 100);
		}
	}
});

// Инициализация
document.addEventListener('DOMContentLoaded', function() {
	// Инициализируем состояние сайдбара
	initSidebarState();
	
	// Назначаем обработчики для переключения сайдбара
	document.getElementById('sidebarOpenBtn').addEventListener('click', toggleSidebar);
	document.getElementById('sidebarCloseBtn').addEventListener('click', toggleSidebar);
	document.getElementById('sidebarOverlay').addEventListener('click', toggleSidebar);
	
	// Загружаем README
	loadMarkdownFile('README.md');
});

// Обработчик изменения размера окна
window.addEventListener('resize', function() {
	// При изменении размера окна обновляем состояние кнопки
	const openBtn = document.getElementById('sidebarOpenBtn');
	const overlay = document.getElementById('sidebarOverlay');
	
	if (window.innerWidth > 768) {
		// На ПК убираем оверлей
		overlay.classList.remove('visible');
	}
	
	// Обновляем видимость кнопки в зависимости от состояния сайдбара
	if (isSidebarHidden) {
		openBtn.style.display = 'flex';
	} else {
		openBtn.style.display = 'none';
	}
});

window.loadMarkdownFile = loadMarkdownFile;