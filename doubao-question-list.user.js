// ==UserScript==
// @name         doubao-question-list
// @namespace    https://github.com/firesahc/webai-question-list
// @version      1.5.0
// @description  展示网页版doubao当前对话的所有提问
// @author       firesahc
// @match        https://www.doubao.com/*
// @license      MIT
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

let observer = null;
let isObserving = false;
let debounceTimer = null;

function createParserInit() {
    const existingList = document.getElementById('xpath-parser-list');
    if (existingList) existingList.remove();

    const listContainer = document.createElement('div');
    listContainer.id = 'xpath-parser-list';
    listContainer.style.cssText = `
        top: 10px;
        right: 50px;
        gap: 8px;
        overflow-y: auto;
        z-index: 1000;
        background: white;
        font-family: Arial, sans-serif;
        font-size: 14px;
        display: flex;
        flex-direction: column;
    `;
    listContainer.style.width = '280px';
    listContainer.style.padding = '6px';
    listContainer.style.border = '2px solid #f5f5f5';

    const contentArea = document.createElement('div');
    contentArea.id = 'xpath-list-content';
    contentArea.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 4px;
    `;

    listContainer.appendChild(contentArea);

    // 将按钮注入豆包原生顶部工具栏
    injectHeaderButtons(listContainer, contentArea);

    // 延迟启动观察器并将面板挂载到页面
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        addQuestionCollapseButtons();

        // 将面板添加到 class="flex-1 flex relative main-with-nav-qPJ0z0" 的元素内部
        const targetContainer = document.querySelector('.flex-1.flex.relative.main-with-nav-qPJ0z0');
        if (targetContainer) {
            targetContainer.appendChild(listContainer);
        }
        else {
            console.error("未找到框架元素class=\"flex-1 flex relative main-with-nav-qPJ0z0\"");
        }
    }, 1500)
}

function startObservation(contentArea) {
    if (isObserving) return true;

    observer = new MutationObserver((mutations) => {
        let shouldParse = false;
        for (const mutation of mutations) {
            // 检查目标元素的类名
            const targetClass = mutation.target.className;

            // 检测到消息列表区域的变化（Doubao 新版使用 message-list-zLoNs1）
            if (mutation.type === 'childList' &&
                typeof targetClass === 'string' &&
                (targetClass.includes('message-list-zLoNs1') || targetClass.includes('inner-item-BjaxFt'))) {
                shouldParse = true;
                break;
            }

            // 检测到滚动区域的变化
            if (mutation.type === 'attributes' &&
                typeof targetClass === 'string' &&
                targetClass.includes('message-list-zLoNs1')) {
                shouldParse = true;
                break;
            }
        }

        if (shouldParse) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const messageElements = parseElements();
                contentArea.innerHTML = '';
                addListMessages(contentArea, messageElements);

                // 为每个目标元素添加收起按钮（仅当内容较长时）
                addElementCollapseButtons(messageElements);
            }, 400);
        }
    });

    // 获取目标元素
    const targetElements = Array.from(
        document.getElementsByClassName('w-full flex-shrink flex-grow basis-0 min-h-100 flex items-center flex-col')
    );
    if (targetElements === 0) {
        console.error("未找到监听元素class=\"w-full flex-shrink flex-grow basis-0 min-h-100 flex items-center flex-col\"");
        return false;
    }

    const targetElement = targetElements[0];
    try {
        // 开始观察目标元素
        observer.observe(targetElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
            characterData: false
        });
        isObserving = true;
        return true;
    } catch (error) {
        isObserving = false;
        return false;
    }
}

function stopObservation() {
    if (observer) {
        observer.disconnect();
        observer = null;
        isObserving = false;
        clearTimeout(debounceTimer);
    }
}

function parseElements() {
    try {
        // 尝试旧版选择器（向后兼容）
        let targetElements = document.querySelectorAll('[data-testid="message_text_content"]:not([data-show-indicator])');

        // 如果旧版选择器无结果，使用新版选择器
        if (targetElements.length === 0) {
            // 新版Doubao使用 data-message-id 标识消息容器，仅选用户问题（justify-end 右对齐）
            targetElements = document.querySelectorAll('[data-message-id].justify-end');
        }

        if (targetElements.length === 0) {
            console.error("未找到消息元素（data-testid 和 data-message-id 均无匹配）");
            return;
        }

        const messageElements = [];
        targetElements.forEach(element => {
            messageElements.push({
                targetElement: element
            });
        });
        if (messageElements.length === 0) {
            return;
        }
        else{
            return messageElements;
        }
    } catch (error) {
        console.error("parseElements error:", error);
        return;
    }
}

function addElementCollapseButtons(messageElements) {
    messageElements.forEach((item, index) => {
        const element = item.targetElement;

        // 检查是否已经添加过按钮
        if (element.hasAttribute('data-collapse-button-added')) {
            return;
        }

        // 找到实际的内容元素（新版可能是 [data-message-id] 容器，需要找到内部内容元素）
        let contentElement = element;
        if (element.hasAttribute('data-message-id')) {
            // 新版结构：尝试找到内部内容元素
            contentElement = element.querySelector('.container-P2rR72') ||  // AI回复内容
                            element.querySelector('[data-container-type] > div > div') ||  // 用户消息内容
                            element.querySelector('[data-container-type] > div') ||
                            element;
        }

        // 如果内容高度不超过400px，不需要添加收起按钮
        if (contentElement.scrollHeight <= 400) {
            return;
        }

        // 标记已添加按钮（在原始element上标记，避免重复添加）
        element.setAttribute('data-collapse-button-added', 'true');

        // 确保内容元素有相对定位，以便按钮可以绝对定位
        const originalPosition = contentElement.style.position;
        if (!originalPosition || originalPosition === 'static') {
            contentElement.style.position = 'relative';
        }

        // 创建收起按钮
        const collapseButton = document.createElement('button');
        collapseButton.textContent = '收起';
        collapseButton.style.cssText = `
            position: absolute;
            top: 5px;
            left: 5px;
            z-index: 1000;
            background: rgba(100, 100, 100, 0.8);
            color: white;
            border: none;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
            opacity: 0.8;
            transition: opacity 0.2s;
        `;

        // 存储原始高度和溢出状态
        const originalHeight = contentElement.style.height;
        const originalOverflow = contentElement.style.overflow;
        let isCollapsed = false;

        collapseButton.addEventListener('mouseenter', () => {
            collapseButton.style.opacity = '1';
        });

        collapseButton.addEventListener('mouseleave', () => {
            collapseButton.style.opacity = '0.8';
        });

        collapseButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isCollapsed) {
                // 展开
                contentElement.style.height = originalHeight || '';
                contentElement.style.overflow = originalOverflow || '';
                collapseButton.textContent = '收起';
                isCollapsed = false;
            } else {
                // 收起
                contentElement.style.height = '110px';
                contentElement.style.overflow = 'hidden';
                collapseButton.textContent = '展开';
                isCollapsed = true;
            }
        });

        // 添加按钮到内容元素
        contentElement.appendChild(collapseButton);
    });
}

function addQuestionCollapseButtons(){
    // 尝试查找目标元素
    const questionElements = Array.from(
        document.getElementsByClassName('pl-16 pr-7 flex-shrink-0')
    );
    if(questionElements.length === 0){
        console.error("未找到输入框框架元素class=\"pl-16 pr-7 flex-shrink-0\"");
        return;
    }
    const questionElement = questionElements[0];

    const toggleButton = document.createElement('button');
    // 获取目标容器元素
    const containerElement = document.querySelector('.flex.min-w-0.flex-grow.flex-col');
    if (!containerElement) {
        console.error("未找到输入框元素class=\"flex.min-w-0.flex-grow.flex-col\"");
        return;
    } else {
        toggleButton.textContent = '▼';
        // 设置容器元素为相对定位，以便按钮可以相对于它定位
        containerElement.style.position = 'relative';
        // 将按钮添加到容器元素内部
        containerElement.appendChild(toggleButton);
        // 设置按钮样式 - 在容器元素内部居中
        toggleButton.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 5%; /* 水平居中定位 */
            transform: translateX(-50%); /* 水平居中调整 */
            z-index: 1000;
            padding: 8px 20px;
            background-color: rgba(255, 255, 255, 0.3);
            color: #000;
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-bottom: none;
            border-radius: 8px 8px 0 0;
            cursor: pointer;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            font-size: 10px;
            font-weight: bold;
            box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
        `;
    }

    // 添加点击事件
    toggleButton.addEventListener('click', function () {
        if (questionElement.style.display === 'none') {
            questionElement.style.display = 'block';
            toggleButton.textContent = '▼';
        } else {
            questionElement.style.display = 'none';
            toggleButton.textContent = '▲';
        };
    });
}

function addListMessages(contentArea, messageElements) {
    const list = document.createElement('ul');
    list.style.cssText = `
        list-style: none;
        margin: 0;
        padding: 0;
    `;

    messageElements.forEach((item, index) => {
        const listItem = createListItem(item, index);
        list.appendChild(listItem);
    });

    contentArea.appendChild(list);
}

function getCleanTextContent(element) {
    // 如果是新版 [data-message-id] 容器，尝试提取内部内容元素的文本
    if (element.hasAttribute('data-message-id')) {
        // 优先从 AI 回复内容容器提取
        const aiContent = element.querySelector('.container-P2rR72');
        if (aiContent) return aiContent.textContent;

        // 用户消息：从内容容器中提取，排除操作栏
        const contentDiv = element.querySelector('[data-container-type] > div');
        if (contentDiv) return contentDiv.textContent;
    }
    // 回退：直接使用元素的 textContent
    return element.textContent;
}

function createListItem(item, index) {
    const listItem = document.createElement('li');
    listItem.style.cssText = `
        margin-bottom: 4px;
        padding: 4px;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        background: #fafafa;
        cursor: pointer;
        transition: all 0.2s ease;
    `;

    listItem.addEventListener('mouseenter', () => {
        listItem.style.background = '#f0f8ff';
        listItem.style.borderColor = '#4CAF50';
    });

    listItem.addEventListener('mouseleave', () => {
        listItem.style.background = '#fafafa';
        listItem.style.borderColor = '#e0e0e0';
    });

    const indexInfo = document.createElement('div');
    indexInfo.style.cssText = `
        font-weight: bold;
        color: #2196F3;
        font-size: 14px;
    `;
    indexInfo.textContent = `问题 ${index + 1}`;

    const contentPreview = document.createElement('div');
    contentPreview.style.cssText = `
        color: #333;
        font-size: 13px;
        line-height: 1.4;
        background: white;
        padding: 4px;
        border-radius: 4px;
        border: 1px solid #e0e0e0;
    `;

    // 获取干净的文本内容（新版 [data-message-id] 容器可能包含操作栏等噪声文本）
    const textContent = getCleanTextContent(item.targetElement)?.trim() || '';
    contentPreview.textContent = textContent ?
        (textContent.length > 120 ?
             textContent.substring(0, 120) + '...' :
             textContent
        ) :
        '[空内容]';

    listItem.appendChild(indexInfo);
    listItem.appendChild(contentPreview);

    //点击跳转到问题起始
    listItem.addEventListener('click', () => {
        item.targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    return listItem;
}

// 将控制按钮注入豆包原生顶部工具栏右侧
function injectHeaderButtons(listContainer, contentArea) {
    // 多次尝试查找工具栏（SPA 页面可能延迟渲染）
    let attempts = 0;
    const maxAttempts = 20;

    function tryInject() {
        const headerRight = document.querySelector('[class*="flex-g-header-right-flex-grow"]');
        if (headerRight && !headerRight.querySelector('.dq-plugin-btn')) {
            createHeaderButtons(headerRight, listContainer, contentArea);
            return;
        }
        attempts++;
        if (attempts < maxAttempts) {
            setTimeout(tryInject, 400);
        } else {
            console.error("未找到豆包顶部工具栏，按钮未能注入");
        }
    }

    tryInject();
}

function createHeaderButtons(headerRight, listContainer, contentArea) {
    // 从存储读取列表可见性
    let isContentVisible = GM_getValue('isContentVisible', true);

    // 初始状态
    listContainer.style.display = isContentVisible ? 'flex' : 'none';

    // 创建解析按钮
    const parseBtn = document.createElement('button');
    parseBtn.className = 'dq-plugin-btn';
    parseBtn.textContent = isObserving ? '停止' : '解析';
    Object.assign(parseBtn.style, {
        padding: '4px 12px',
        height: '32px',
        border: '1px solid var(--dbx-line-10, #e5e5e5)',
        borderRadius: '8px',
        background: 'transparent',
        color: 'var(--dbx-text-secondary, #666)',
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
        flexShrink: '0',
    });

    parseBtn.addEventListener('mouseenter', () => {
        parseBtn.style.background = 'var(--dbx-fill-trans-10-hover, rgba(0,0,0,0.05))';
    });
    parseBtn.addEventListener('mouseleave', () => {
        parseBtn.style.background = 'transparent';
    });
    parseBtn.addEventListener('click', () => {
        if (isObserving) {
            stopObservation();
            parseBtn.textContent = '解析';
            parseBtn.style.color = 'var(--dbx-text-secondary, #666)';
        } else {
            const success = startObservation(contentArea);
            if (success) {
                parseBtn.textContent = '停止';
                parseBtn.style.color = 'var(--dbx-text-brand, #4A6CF7)';
                const messageElements = parseElements();
                contentArea.innerHTML = '';
                addListMessages(contentArea, messageElements);
                addElementCollapseButtons(messageElements);
            }
        }
    });

    // 初始化解析按钮状态
    if (isObserving) {
        parseBtn.textContent = '停止';
        parseBtn.style.color = 'var(--dbx-text-brand, #4A6CF7)';
    }

    // 创建列表切换按钮
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'dq-plugin-btn';
    toggleBtn.textContent = isContentVisible ? '列表' : '列表';
    Object.assign(toggleBtn.style, {
        padding: '4px 12px',
        height: '32px',
        border: '1px solid var(--dbx-line-10, #e5e5e5)',
        borderRadius: '8px',
        background: 'transparent',
        color: isContentVisible ? 'var(--dbx-text-brand, #4A6CF7)' : 'var(--dbx-text-secondary, #666)',
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
        flexShrink: '0',
    });

    toggleBtn.addEventListener('mouseenter', () => {
        toggleBtn.style.background = 'var(--dbx-fill-trans-10-hover, rgba(0,0,0,0.05))';
    });
    toggleBtn.addEventListener('mouseleave', () => {
        toggleBtn.style.background = 'transparent';
    });
    toggleBtn.addEventListener('click', () => {
        isContentVisible = !isContentVisible;
        listContainer.style.display = isContentVisible ? 'flex' : 'none';
        toggleBtn.style.color = isContentVisible ? 'var(--dbx-text-brand, #4A6CF7)' : 'var(--dbx-text-secondary, #666)';
        GM_setValue('isContentVisible', isContentVisible);
    });

    headerRight.appendChild(parseBtn);
    headerRight.appendChild(toggleBtn);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createParserInit);
} else {
    createParserInit();
}

window.createParser = createParserInit;
window.parseTarget = function() {
    const contentArea = document.getElementById('xpath-list-content');
    if (contentArea) {
        const messageElements = parseElements();
        contentArea.innerHTML = '';
        addListMessages(contentArea, messageElements);

        // 为每个目标元素添加收起按钮（仅当内容较长时）
        addElementCollapseButtons(messageElements);
    }
};
