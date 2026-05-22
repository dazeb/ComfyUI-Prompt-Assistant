     1|/**
     2| * 标签管理器
     3| * 负责管理标签的显示和操作
     4| */
     5|
     6|import { logger } from '../utils/logger.js';
     7|import { CacheService, TagCacheService } from "../services/cache.js";
     8|import { UIToolkit } from "../utils/UIToolkit.js";
     9|import { PopupManager } from "../utils/popupManager.js";
    10|import { ResourceManager } from "../utils/resourceManager.js";
    11|import { EventManager } from "../utils/eventManager.js";
    12|import { PromptFormatter } from "../utils/promptFormatter.js";
    13|import { createSettingsDialog, showContextMenu, createConfirmPopup } from "./uiComponents.js";
    14|/**
    15| * 标签管理器类
    16| * 管理标签弹窗和标签选择
    17| */
    18|class TagManager {
    19|    // ---UI状态持久化配置---
    20|    static LAST_TAB_KEY = 'PromptAssistant_TagPopup_LastTab';           // 上次激活的标签页
    21|    static ACCORDION_STATE_KEY = 'PromptAssistant_TagPopup_AccordionState'; // 手风琴展开状态
    22|    static POPUP_SIZE_KEY = 'PromptAssistant_TagPopup_Size';            // 弹窗尺寸
    23|
    24|    /**
    25|     * 获取上次激活的标签页（分类名）
    26|     */
    27|    static getLastActiveTab() {
    28|        try {
    29|            return CacheService.get(this.LAST_TAB_KEY) || null;
    30|        } catch (e) {
    31|            return null;
    32|        }
    33|    }
    34|
    35|    /**
    36|     * 记录本次激活的标签页（分类名）
    37|     */
    38|    static setLastActiveTab(category) {
    39|        try {
    40|            if (category && typeof category === 'string') {
    41|                CacheService.set(this.LAST_TAB_KEY, category);
    42|            }
    43|        } catch (e) { }
    44|    }
    45|
    46|    /**
    47|     * 获取手风琴展开状态
    48|     * @returns {Object} { tabName: { accordionPath: isExpanded } }
    49|     */
    50|    static getAccordionState() {
    51|        try {
    52|            const state = CacheService.get(this.ACCORDION_STATE_KEY);
    53|            return state ? JSON.parse(state) : {};
    54|        } catch (e) {
    55|            return {};
    56|        }
    57|    }
    58|
    59|    /**
    60|     * 保存手风琴展开状态
    61|     * @param {string} tabName 标签页名称
    62|     * @param {string} accordionPath 手风琴路径（用分类名表示）
    63|     * @param {boolean} isExpanded 是否展开
    64|     */
    65|    static setAccordionState(tabName, accordionPath, isExpanded) {
    66|        try {
    67|            const state = this.getAccordionState();
    68|            if (!state[tabName]) {
    69|                state[tabName] = {};
    70|            }
    71|            state[tabName][accordionPath] = isExpanded;
    72|            CacheService.set(this.ACCORDION_STATE_KEY, JSON.stringify(state));
    73|        } catch (e) {
    74|            logger.error(`保存手风琴状态失败: ${e.message}`);
    75|        }
    76|    }
    77|
    78|    /**
    79|     * 获取保存的弹窗尺寸
    80|     * @returns {Object|null} { width: number, height: number }
    81|     */
    82|    static getPopupSize() {
    83|        try {
    84|            const size = CacheService.get(this.POPUP_SIZE_KEY);
    85|            return size ? JSON.parse(size) : null;
    86|        } catch (e) {
    87|            return null;
    88|        }
    89|    }
    90|
    91|    /**
    92|     * 保存弹窗尺寸
    93|     * @param {number} width 宽度
    94|     * @param {number} height 高度
    95|     */
    96|    static setPopupSize(width, height) {
    97|        try {
    98|            const size = { width, height };
    99|            CacheService.set(this.POPUP_SIZE_KEY, JSON.stringify(size));
   100|        } catch (e) {
   101|            logger.error(`保存窗口大小失败: ${e.message}`);
   102|        }
   103|    }
   104|
   105|    /**
   106|     * 递归查找分类对象
   107|     * @param {Object} obj 数据对象
   108|     * @param {string} catName 分类名称
   109|     * @returns {Object|null} 找到的分类对象或 null
   110|     * @note 对于虚拟分类"标签"（仅在没有实际分类时使用），返回根对象本身
   111|     */
   112|    static _findCategoryRecursively(obj, catName) {
   113|        if (!obj || typeof obj !== 'object') return null;
   114|        // 虚拟分类"标签"代表根级别，返回根对象本身
   115|        // 这个分类仅在 CSV 中没有任何实际分类，只有根标签时使用
   116|        if (catName === "" || catName === "标签") return obj;
   117|
   118|        for (const [key, value] of Object.entries(obj)) {
   119|            if (key === catName && typeof value === 'object' && value !== null) {
   120|                return value;
   121|            }
   122|            if (typeof value === 'object' && value !== null) {
   123|                const result = this._findCategoryRecursively(value, catName);
   124|                if (result) return result;
   125|            }
   126|        }
   127|        return null;
   128|    }
   129|
   130|    /**
   131|     * 递归查找标签及其父对象
   132|     * @param {Object} obj 数据对象
   133|     * @param {string} tagName 标签名称
   134|     * @param {string} tagValue 标签值
   135|     * @returns {Object|null} 包含 {parent, key} 的对象或 null
   136|     */
   137|    static _findTagRecursively(obj, tagName, tagValue) {
   138|        if (!obj || typeof obj !== 'object') return null;
   139|
   140|        for (const [key, value] of Object.entries(obj)) {
   141|            if (key === tagName && value === tagValue) {
   142|                return { parent: obj, key: key };
   143|            }
   144|            if (typeof value === 'object' && value !== null) {
   145|                const result = this._findTagRecursively(value, tagName, tagValue);
   146|                if (result) return result;
   147|            }
   148|        }
   149|        return null;
   150|    }
   151|    static popupInstance = null;
   152|    static onCloseCallback = null;  // 添加关闭回调存储
   153|    static eventCleanups = [];      // 事件清理函数数组
   154|    static searchTimeout = null;    // 搜索延迟定时器
   155|    static currentNodeId = null;
   156|    static currentInputId = null;
   157|    static currentWidgetKey = null;
   158|    static activeTooltip = null;
   159|    static usedTags = new Map();    // 存储已使用标签的Map: key为标签值，value为对应的DOM元素
   160|    static currentCsvFile = null;   // 当前选中的CSV文件
   161|    static favorites = {};          // 收藏列表缓存 {name: value}
   162|    static tagLookup = new Map();   // 标签值到名称的映射表
   163|    static Sortable = null;         // Sortable 库引用
   164|    static sortables = [];          // 存储 sortable 实例以供清理
   165|    static tagData = null;          // 当前CSV文件的标签数据
   166|
   167|    /**
   168|     * 初始化 Sortable
   169|     */
   170|    static async _initSortable() {
   171|        if (this.Sortable) return;
   172|        try {
   173|            this.Sortable = await ResourceManager.getSortable();
   174|        } catch (error) {
   175|            logger.warn('Sortable library not loaded', error);
   176|        }
   177|    }
   178|
   179|
   180|    /**
   181|     * 检查标签是否已插入到输入框中
   182|     */
   183|    static isTagUsed(tagValue, nodeId, inputId) {
   184|        const mapping = UIToolkit._findMapping(nodeId, inputId, this.currentWidgetKey);
   185|        if (!mapping || !mapping.inputEl) return false;
   186|
   187|        // 检查输入框内容是否包含标签的任一格式
   188|        const inputValue = mapping.inputEl.value;
   189|        return TagCacheService.isTagInInput(nodeId, inputId, tagValue, inputValue);
   190|    }
   191|
   192|    /**
   193|     * 更新标签状态
   194|     */
   195|    static updateTagState(tagElement, isUsed) {
   196|        if (isUsed) {
   197|            tagElement.classList.add('used');
   198|        } else {
   199|            tagElement.classList.remove('used');
   200|        }
   201|    }
   202|
   203|    /**
   204|     * 处理标签点击
   205|     */
   206|    static handleTagClick(tagElement, tagName, tagValue, e) {
   207|        // 阻止事件冒泡，确保弹窗不会关闭
   208|        e.stopPropagation();
   209|
   210|        // 获取输入框信息
   211|        const mapping = UIToolkit._findMapping(this.currentNodeId, this.currentInputId, this.currentWidgetKey);
   212|        if (!mapping || !mapping.inputEl) return;
   213|
   214|        const inputEl = mapping.inputEl;
   215|        const inputValue = inputEl.value;
   216|
   217|        // 判断标签是否已使用
   218|        const isUsed = this.isTagUsed(tagValue, this.currentNodeId, this.currentInputId);
   219|
   220|        try {
   221|            if (isUsed) {
   222|                // 标签已使用，移除
   223|                // 确保移除tooltip
   224|                this._hideTooltip();
   225|                this.removeTag(tagValue, this.currentNodeId, this.currentInputId, true);
   226|                this.updateTagState(tagElement, false);
   227|                this.usedTags.delete(tagValue);
   228|
   229|                // 立即更新所有标签页中的标签状态
   230|                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
   231|                // 如果当前在搜索状态，也要更新搜索结果中的标签状态
   232|                const searchResultList = document.querySelector('.tag_search_result_list');
   233|                if (searchResultList) {
   234|                    this.refreshSearchResultsState();
   235|                }
   236|
   237|                // logger.debug(`标签操作 | 动作:移除 | 标签:"${tagName}" | 原始值:"${tagValue}"`);
   238|            } else {
   239|                // 标签未使用，插入
   240|                // 获取光标位置前后的文本
   241|                const cursorPos = inputEl.selectionStart;
   242|                const beforeText = inputValue.substring(0, cursorPos);
   243|                const afterText = inputValue.substring(cursorPos);
   244|
   245|                // 确定使用哪种格式
   246|                const formatType = PromptFormatter.determineFormatType(beforeText, afterText);
   247|
   248|                // 获取或创建标签格式
   249|                let formats;
   250|                const existingFormats = TagCacheService.getTagFormats(this.currentNodeId, this.currentInputId, tagValue);
   251|                if (existingFormats) {
   252|                    // 如果缓存中已有该标签的格式，直接使用缓存的格式
   253|                    formats = existingFormats;
   254|                } else {
   255|                    // 如果缓存中没有，创建新的格式
   256|                    formats = PromptFormatter.formatTag(tagValue);
   257|                }
   258|
   259|                // 根据formatType选择要插入的格式
   260|                let insertFormat;
   261|                switch (formatType) {
   262|                    case 1:
   263|                        insertFormat = formats.format1;
   264|                        break;
   265|                    case 2:
   266|                        insertFormat = formats.format2;
   267|                        break;
   268|                    case 3:
   269|                        insertFormat = formats.format3;
   270|                        break;
   271|                    case 4:
   272|                        insertFormat = formats.format4;
   273|                        break;
   274|                    default:
   275|                        insertFormat = formats.format2; // 默认使用格式2
   276|                }
   277|
   278|                // 如果是新创建的格式，添加到缓存
   279|                if (!existingFormats) {
   280|                    formats.insertedFormat = insertFormat;
   281|                    TagCacheService.addTag(this.currentNodeId, this.currentInputId, tagValue, formats);
   282|                } else {
   283|                    // 如果是已存在的格式，更新insertedFormat
   284|                    TagCacheService.updateInsertedFormat(this.currentNodeId, this.currentInputId, tagValue, insertFormat);
   285|                }
   286|
   287|                // 插入到光标位置
   288|                UIToolkit.insertAtCursor(insertFormat, this.currentNodeId, this.currentInputId, {
   289|                    highlight: true,
   290|                    keepFocus: true,
   291|                    widgetKey: this.currentWidgetKey
   292|                });
   293|
   294|                // 更新光标位置到插入内容之后
   295|                setTimeout(() => {
   296|                    if (inputEl === document.activeElement) {
   297|                        const newPos = cursorPos + insertFormat.length;
   298|                        inputEl.setSelectionRange(newPos, newPos);
   299|                        inputEl.focus();
   300|                    }
   301|                }, 0);
   302|
   303|                // 更新标签状态
   304|                this.updateTagState(tagElement, true);
   305|                this.usedTags.set(tagValue, tagElement);
   306|
   307|                // 立即更新所有标签页中的标签状态
   308|                this.updateAllTagsState(this.currentNodeId, this.currentInputId);
   309|                // 如果当前在搜索状态，也要更新搜索结果中的标签状态
   310|                const searchResultList = document.querySelector('.tag_search_result_list');
   311|                if (searchResultList) {
   312|                    this.refreshSearchResultsState();
   313|                }
   314|
   315|                // logger.debug(`标签操作 | 动作:插入 | 标签:"${tagName}" | 原始值:"${tagValue}" | 格式类型:${formatType} | 插入格式:"${insertFormat}"`);
   316|            }
   317|        } catch (error) {
   318|            logger.error(`标签操作失败 | 标签:"${tagName}" | 错误:${error.message}`);
   319|        }
   320|    }
   321|
   322|    /**
   323|     * 从输入框中移除标签
   324|     */
   325|    static removeTag(tagValue, nodeId, inputId, keepFocus = true) {
   326|        const mapping = UIToolkit._findMapping(nodeId, inputId, this.currentWidgetKey);
   327|
   328|        if (mapping && mapping.inputEl) {
   329|            const inputEl = mapping.inputEl;
   330|            const currentValue = inputEl.value;
   331|
   332|            // 获取标签的所有格式
   333|            const formatInfo = TagCacheService.getTagFormats(nodeId, inputId, tagValue);
   334|            if (!formatInfo) return false;
   335|
   336|            // 优先使用insertedFormat进行精确匹配
   337|            if (formatInfo.insertedFormat) {
   338|                const tagIndex = currentValue.indexOf(formatInfo.insertedFormat);
   339|                if (tagIndex !== -1) {
   340|                    // 直接使用精确替换，不进行额外的清理
   341|                    const newValue = currentValue.substring(0, tagIndex) +
   342|                        currentValue.substring(tagIndex + formatInfo.insertedFormat.length);
   343|
   344|                    // 更新输入框值
   345|                    inputEl.value = newValue;
   346|
   347|                    // 触发事件
   348|                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
   349|                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
   350|
   351|                    if (keepFocus) {
   352|                        inputEl.focus();
   353|                    }
   354|
   355|                    logger.debug(`标签移除 | 方式:精确匹配 | 标签:${tagValue} | 格式:"${formatInfo.insertedFormat}"`);
   356|                    return true;
   357|                }
   358|            }
   359|
   360|            // 如果insertedFormat不存在或未找到，按优先级尝试其他格式
   361|            const removeOrder = ['format4', 'format3', 'format2', 'format1'];
   362|
   363|            for (const formatKey of removeOrder) {
   364|                const format = formatInfo[formatKey];
   365|                if (!format) continue;
   366|
   367|                const tagIndex = currentValue.indexOf(format);
   368|                if (tagIndex !== -1) {
   369|                    // 检查是否是独立的标签（前后是空格或标点）
   370|                    const isValidRemoval = this._isValidTagRemoval(currentValue, tagIndex, format);
   371|                    if (isValidRemoval) {
   372|                        // 直接使用精确替换，不进行额外的清理
   373|                        const newValue = currentValue.substring(0, tagIndex) +
   374|                            currentValue.substring(tagIndex + format.length);
   375|
   376|                        // 更新输入框值
   377|                        inputEl.value = newValue;
   378|
   379|                        // 触发事件
   380|                        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
   381|                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
   382|
   383|                        if (keepFocus) {
   384|                            inputEl.focus();
   385|                        }
   386|
   387|                        logger.debug(`标签移除 | 方式:格式匹配 | 标签:${tagValue} | 格式:${formatKey}`);
   388|                        return true;
   389|                    }
   390|                }
   391|            }
   392|        }
   393|
   394|        return false;
   395|    }
   396|
   397|    /**
   398|     * 检查标签移除是否有效
   399|     */
   400|    static _isValidTagRemoval(value, index, format) {
   401|        // 获取标签前后的字符
   402|        const beforeChar = index > 0 ? value[index - 1] : '';
   403|        const afterChar = index + format.length < value.length ? value[index + format.length] : '';
   404|
   405|        // 检查前后字符是否是空格或标点
   406|        const isValidChar = char => !char || char === ' ' || char === ',' || char === '.' || char === ';';
   407|
   408|        return isValidChar(beforeChar) && isValidChar(afterChar);
   409|    }
   410|
   411|    /**
   412|     * 清理标签移除后的文本
   413|     */
   414|    static _cleanupAfterRemoval(text, removePosition, removeLength) {
   415|        // 获取移除位置前后的一小段文本进行清理
   416|        const cleanRange = 10; // 清理范围（前后各10个字符）
   417|        const startClean = Math.max(0, removePosition - cleanRange);
   418|        const endClean = Math.min(text.length, removePosition + cleanRange);
   419|
   420|        // 分割文本为三部分：前段、清理段、后段
   421|        const beforeText = text.substring(0, startClean);
   422|        let cleanText = text.substring(startClean, endClean);
   423|        const afterText = text.substring(endClean);
   424|
   425|        // 只清理中间部分
   426|        cleanText = cleanText
   427|            // 移除连续的逗号
   428|            .replace(/,\s*,/g, ',')
   429|            // 确保逗号后有一个空格
   430|            .replace(/,(\S)/g, ', $1')
   431|            // 移除多余的空格
   432|            .replace(/\s+/g, ' ')
   433|            .trim();
   434|
   435|        // 重新组合文本
   436|        let result = beforeText + cleanText + afterText;
   437|
   438|        // 处理首尾
   439|        if (removePosition === 0) {
   440|            result = result.replace(/^\s*,\s*/, ''); // 如果标签在开头，移除开头的逗号和空格
   441|        }
   442|        if (removePosition + removeLength >= text.length) {
   443|            result = result.replace(/\s*,\s*$/, ''); // 如果标签在结尾，移除结尾的逗号和空格
   444|        }
   445|
   446|        return result;
   447|    }
   448|
   449|    /**
   450|     * 创建并显示tooltip
   451|     */
   452|    static _showTooltip(target, text) {
   453|        // 移除已存在的tooltip
   454|        this._hideTooltip();
   455|
   456|        // 创建tooltip元素
   457|        const tooltip = document.createElement('div');
   458|        tooltip.className = 'tag_tooltip';
   459|        tooltip.innerHTML = text; // 使用 innerHTML 以支持 HTML 内容
   460|        document.body.appendChild(tooltip);
   461|
   462|        // 获取目标元素的位置和尺寸
   463|        const rect = target.getBoundingClientRect();
   464|
   465|        // 计算tooltip位置
   466|        const tooltipRect = tooltip.getBoundingClientRect();
   467|        const left = rect.left + (rect.width - tooltipRect.width) / 2;
   468|        const top = rect.top - tooltipRect.height - 8; // 8px的间距
   469|
   470|        // 设置tooltip位置
   471|        tooltip.style.left = `${left}px`;
   472|        tooltip.style.top = `${top}px`;
   473|
   474|        // 保存当前tooltip引用
   475|        this.activeTooltip = tooltip;
   476|    }
   477|
   478|    /**
   479|     * 隐藏tooltip
   480|     */
   481|    static _hideTooltip() {
   482|        if (this.activeTooltip) {
   483|            this.activeTooltip.remove();
   484|            this.activeTooltip = null;
   485|        }
   486|    }
   487|
   488|    /**
   489|     * 优化的手风琴切换方法 - 使用动态高度计算，解决跳帧问题
   490|     */
   491|    static _toggleAccordion(header, content, headerIcon) {
   492|        const isExpanding = !header.classList.contains('active');
   493|
   494|        // 防止重复触发动画
   495|        if (content.dataset.animating === 'true') {
   496|            return;
   497|        }
   498|
   499|        // 标记动画状态
   500|        content.dataset.animating = 'true';
   501|
   502|        if (isExpanding) {
   503|            // 展开手风琴
   504|            header.classList.add('active');
   505|            content.classList.add('active');
   506|
   507|            // 临时移除过渡效果来测量高度
   508|            content.style.transition = 'none';
   509|            content.style.maxHeight = 'none';
   510|            content.style.overflow = 'visible';
   511|            content.style.padding = '2px 0'; // 确保padding正确
   512|
   513|            // 强制回流并获取准确高度
   514|            void content.offsetHeight;
   515|            const contentHeight = content.scrollHeight;
   516|
   517|            // 设置动画起始状态
   518|            content.style.maxHeight = '0px';
   519|            content.style.padding = '0';
   520|            content.style.overflow = 'hidden';
   521|
   522|            // 再次强制回流
   523|            void content.offsetHeight;
   524|
   525|            // 启用过渡效果并开始动画
   526|            content.style.transition = 'max-height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
   527|
   528|            // 使用requestAnimationFrame确保动画平滑
   529|            requestAnimationFrame(() => {
   530|                content.style.maxHeight = contentHeight + 'px';
   531|                content.style.padding = '2px 0';
   532|            });
   533|
   534|            // 监听动画结束事件
   535|            const handleTransitionEnd = (e) => {
   536|                if (e.target === content && e.propertyName === 'max-height') {
   537|                    content.removeEventListener('transitionend', handleTransitionEnd);
   538|
   539|                    // 动画完成后的清理工作
   540|                    if (content.classList.contains('active')) {
   541|                        content.style.maxHeight = 'none';
   542|                        content.style.overflow = 'visible';
   543|                        content.style.transition = '';
   544|                    }
   545|
   546|                    // 清除动画状态标记
   547|                    content.dataset.animating = 'false';
   548|                }
   549|            };
   550|
   551|            content.addEventListener('transitionend', handleTransitionEnd);
   552|
   553|            // 备用清理机制（防止事件未触发）
   554|            setTimeout(() => {
   555|                if (content.dataset.animating === 'true') {
   556|                    content.dataset.animating = 'false';
   557|                    if (content.classList.contains('active')) {
   558|                        content.style.maxHeight = 'none';
   559|                        content.style.overflow = 'visible';
   560|                        content.style.transition = '';
   561|                    }
   562|                }
   563|            }, 250); // 调整为0.2s + 50ms缓冲
   564|
   565|        } else {
   566|            // 收起手风琴
   567|            // 立即移除header的active类以更新视觉状态
   568|            header.classList.remove('active');
   569|
   570|            // 获取当前高度作为动画起点
   571|            const currentHeight = content.scrollHeight;
   572|
   573|            // 设置起始状态
   574|            content.style.transition = 'none';
   575|            content.style.maxHeight = currentHeight + 'px';
   576|            content.style.overflow = 'hidden';
   577|
   578|            // 强制回流
   579|            void content.offsetHeight;
   580|
   581|            // 启用过渡效果
   582|            content.style.transition = 'max-height 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
   583|
   584|            // 使用requestAnimationFrame确保动画平滑
   585|            requestAnimationFrame(() => {
   586|                content.style.maxHeight = '0px';
   587|                content.style.padding = '0';
   588|            });
   589|
   590|            // 监听动画结束事件
   591|            const handleTransitionEnd = (e) => {
   592|                if (e.target === content && e.propertyName === 'max-height') {
   593|                    content.removeEventListener('transitionend', handleTransitionEnd);
   594|
   595|                    // 动画完成后移除active类和清理样式
   596|                    content.classList.remove('active');
   597|                    content.style.transition = '';
   598|                    content.style.maxHeight = '';
   599|                    content.style.padding = '';
   600|                    content.style.overflow = '';
   601|
   602|                    // 清除动画状态标记
   603|                    content.dataset.animating = 'false';
   604|                }
   605|            };
   606|
   607|            content.addEventListener('transitionend', handleTransitionEnd);
   608|
   609|            // 备用清理机制（防止事件未触发）
   610|            setTimeout(() => {
   611|                if (content.dataset.animating === 'true') {
   612|                    content.dataset.animating = 'false';
   613|                    content.classList.remove('active');
   614|                    content.style.transition = '';
   615|                    content.style.maxHeight = '';
   616|                    content.style.padding = '';
   617|                    content.style.overflow = '';
   618|                }
   619|            }, 250); // 调整为0.2s + 50ms缓冲
   620|        }
   621|
   622|        // 切换图标旋转
   623|        const arrowIcon = headerIcon.querySelector('.pi.pi-chevron-down, .accordion_arrow_icon');
   624|        if (arrowIcon) {
   625|            arrowIcon.classList.toggle('rotate-180');
   626|        }
   627|    }
   628|
   629|    /**
   630|     * 递归创建标签结构
   631|     * @param {Object} data 数据对象
   632|     * @param {string} level 层级
   633|     * @param {string} tabName 标签页名称（用于恢复状态）
   634|     */
   635|    static _createAccordionContent(data, level = '0', tabName = null, categoryName = null) {
   636|        // 如果是顶级（一级分类），则创建标签页结构
   637|        if (level === '0') {
   638|            // 创建外层容器
   639|            const container = document.createElement('div');
   640|            container.style.display = 'flex';
   641|            container.style.flexDirection = 'column';
   642|            container.style.height = '100%';
   643|            container.style.overflow = 'hidden';
   644|
   645|            // 创建标签页容器
   646|            const tabsContainer = document.createElement('div');
   647|            tabsContainer.className = 'popup_tabs_container';
   648|
   649|            // 创建标签滚动区域
   650|            const tabsScroll = document.createElement('div');
   651|            tabsScroll.className = 'popup_tabs_scroll';
   652|
   653|            // 创建标签栏
   654|            const tabs = document.createElement('div');
   655|            tabs.className = 'popup_tabs';
   656|
   657|            // 创建内容区域
   658|            const tabContents = document.createElement('div');
   659|            tabContents.className = 'tag_category_container';
   660|            tabContents.style.overflow = 'hidden';
   661|            tabContents.style.display = 'flex';
   662|            tabContents.style.flexDirection = 'column';
   663|            tabContents.style.flex = '1'; // 确保内容区域占满剩余空间
   664|            tabContents.style.minHeight = '0'; // 允许flex收缩
   665|            tabContents.style.flex = '1'; // 确保内容区域占满剩余空间
   666|            tabContents.style.minHeight = '0'; // 允许flex收缩
   667|
   668|            // 获取所有一级分类和标签
   669|            const categories = Object.keys(data);
   670|
   671|            // 分离根级别标签（字符串值）和实际分类（对象值）
   672|            // 注意：我们只在渲染时分离，不修改原始 data 对象
   673|            const rootTags = {};
   674|            const actualCategories = [];
   675|            categories.forEach(key => {
   676|                if (typeof data[key] === 'string') {
   677|                    rootTags[key] = data[key];
   678|                } else {
   679|                    actualCategories.push(key);
   680|                }
   681|            });
   682|
   683|            // 如果没有分类且没有根标签，返回空容器
   684|            if (actualCategories.length === 0 && Object.keys(rootTags).length === 0) {
   685|                const emptyContainer = document.createElement('div');
   686|                emptyContainer.className = 'tag_category_container';
   687|                return emptyContainer;
   688|            }
   689|
   690|            // 创建左右滚动指示器
   691|            const leftIndicator = document.createElement('div');
   692|            leftIndicator.className = 'tabs_scroll_indicator left';
   693|
   694|            // 添加图标
   695|            const leftIconSpan = document.createElement('span');
   696|            leftIconSpan.className = 'pi pi-angle-left scroll_indicator_icon';
   697|            leftIndicator.appendChild(leftIconSpan);
   698|            leftIndicator.style.display = 'none'; // 初始隐藏
   699|
   700|            const rightIndicator = document.createElement('div');
   701|            rightIndicator.className = 'tabs_scroll_indicator right';
   702|
   703|            // 添加图标
   704|            const rightIconSpan = document.createElement('span');
   705|            rightIconSpan.className = 'pi pi-angle-right scroll_indicator_icon';
   706|            rightIndicator.appendChild(rightIconSpan);
   707|            rightIndicator.style.display = 'none'; // 初始隐藏
   708|
   709|            // 更新指示器状态的函数
   710|            const updateIndicators = () => {
   711|                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
   712|                if (!canScroll) {
   713|                    leftIndicator.style.display = 'none';
   714|                    rightIndicator.style.display = 'none';
   715|                    return;
   716|                }
   717|                // 使用更大的阈值（5像素）确保边界情况下能正确隐藏
   718|                const scrollLeft = tabsScroll.scrollLeft;
   719|                const maxScroll = tabsScroll.scrollWidth - tabsScroll.clientWidth;
   720|
   721|                // 移除高频滚动调试日志
   722|
   723|                leftIndicator.style.display = scrollLeft > 5 ? 'flex' : 'none';
   724|                rightIndicator.style.display = scrollLeft < (maxScroll - 5) ? 'flex' : 'none';
   725|            };
   726|
   727|            // 添加指示器点击事件 - 每次滚动一个标签
   728|            const leftClickCleanup = EventManager.addDOMListener(leftIndicator, 'click', () => {
   729|                // 获取所有标签
   730|                const allTabs = tabs.querySelectorAll('.popup_tab');
   731|                if (allTabs.length === 0) return;
   732|
   733|                // 找到当前第一个可见的标签
   734|                const scrollRect = tabsScroll.getBoundingClientRect();
   735|                let firstVisibleTab = null;
   736|
   737|                for (const tab of allTabs) {
   738|                    const tabRect = tab.getBoundingClientRect();
   739|                    // 如果标签的右边缘在可视区域内，说明它至少部分可见
   740|                    if (tabRect.right > scrollRect.left + 10) {
   741|                        firstVisibleTab = tab;
   742|                        break;
   743|                    }
   744|                }
   745|
   746|                // 找到前一个标签
   747|                if (firstVisibleTab) {
   748|                    const currentIndex = Array.from(allTabs).indexOf(firstVisibleTab);
   749|                    if (currentIndex > 0) {
   750|                        const prevTab = allTabs[currentIndex - 1];
   751|                        prevTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
   752|                        // 滚动完成后更新指示器状态（使用更长的延迟确保动画完成）
   753|                        setTimeout(updateIndicators, 600);
   754|                    }
   755|                }
   756|            });
   757|
   758|            const rightClickCleanup = EventManager.addDOMListener(rightIndicator, 'click', () => {
   759|                // 获取所有标签
   760|                const allTabs = tabs.querySelectorAll('.popup_tab');
   761|                if (allTabs.length === 0) return;
   762|
   763|                // 找到当前最后一个可见的标签
   764|                const scrollRect = tabsScroll.getBoundingClientRect();
   765|                let lastVisibleTab = null;
   766|
   767|                for (let i = allTabs.length - 1; i >= 0; i--) {
   768|                    const tab = allTabs[i];
   769|                    const tabRect = tab.getBoundingClientRect();
   770|                    // 如果标签的左边缘在可视区域内，说明它至少部分可见
   771|                    if (tabRect.left < scrollRect.right - 10) {
   772|                        lastVisibleTab = tab;
   773|                        break;
   774|                    }
   775|                }
   776|
   777|                // 找到下一个标签
   778|                if (lastVisibleTab) {
   779|                    const currentIndex = Array.from(allTabs).indexOf(lastVisibleTab);
   780|                    if (currentIndex < allTabs.length - 1) {
   781|                        const nextTab = allTabs[currentIndex + 1];
   782|                        nextTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
   783|                        // 滚动完成后更新指示器状态（使用更长的延迟确保动画完成）
   784|                        setTimeout(updateIndicators, 600);
   785|                    }
   786|                }
   787|            });
   788|
   789|            // 监听滚动事件，显示/隐藏滚动指示器
   790|            const scrollCleanup = EventManager.addDOMListener(tabsScroll, 'scroll', updateIndicators);
   791|
   792|            // 监听窗口大小调整事件
   793|            const resizeObserver = new ResizeObserver(() => {
   794|                updateIndicators();
   795|            });
   796|            resizeObserver.observe(popup);
   797|
   798|            // 添加清理函数
   799|            const resizeCleanup = () => {
   800|                resizeObserver.disconnect();
   801|            };
   802|
   803|            this.eventCleanups.push(leftClickCleanup, rightClickCleanup, scrollCleanup, resizeCleanup);
   804|
   805|            // 初始检测是否需要滚动指示器，并自动定位到激活的标签页
   806|            setTimeout(() => {
   807|                // 检查是否需要滚动
   808|                const canScroll = tabsScroll.scrollWidth > tabsScroll.clientWidth;
   809|
   810|                if (canScroll) {
   811|                    // 找到激活的标签页
   812|                    const activeTab = tabs.querySelector('.popup_tab.active');
   813|                    if (activeTab) {
   814|                        // 将激活的标签页滚动到可见区域
   815|                        activeTab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
   816|                    }
   817|
   818|                    // 等待滚动完成后，更新滚动指示器显示状态
   819|                    setTimeout(updateIndicators, 50);
   820|                }
   821|            }, 100);
   822|
   823|            // 如果没有实际分类但有根标签，创建一个默认 Tab 来显示它们
   824|            const finalCategories = actualCategories.length > 0 ? actualCategories : (Object.keys(rootTags).length > 0 ? ["标签"] : []);
   825|
   826|            // 为每个分类创建标签和内容
   827|            finalCategories.forEach((category, index) => {
   828|                // 创建标签
   829|                const tab = document.createElement('div');
   830|                tab.className = 'popup_tab';
   831|                tab.textContent = category;
   832|                tab.setAttribute('data-category', category);
   833|
   834|                // 第一个标签默认激活
   835|                if (index === 0) {
   836|                    tab.classList.add('active');
   837|                }
   838|
   839|                // 添加标签点击事件
   840|                const tabClickCleanup = EventManager.addDOMListener(tab, 'click', (e) => {
   841|                    // 获取当前激活的标签
   842|                    const currentActiveTab = tabs.querySelector('.popup_tab.active');
   843|
   844|                    // 如果点击的是当前激活的标签，不做任何处理
   845|                    if (currentActiveTab === tab) return;
   846|
   847|                    // 为当前激活的标签添加退出动画
   848|                    if (currentActiveTab) {
   849|                        currentActiveTab.classList.add('exiting');
   850|                        // 监听动画结束
   851|                        const animationEndHandler = () => {
   852|                            currentActiveTab.classList.remove('active', 'exiting');
   853|                            currentActiveTab.removeEventListener('transitionend', animationEndHandler);
   854|                        };
   855|                        currentActiveTab.addEventListener('transitionend', animationEndHandler);
   856|                    }
   857|
   858|                    // 移除所有内容的active类
   859|                    tabContents.querySelectorAll('.popup_tab_content').forEach(c => {
   860|                        c.classList.remove('active');
   861|                        c.style.display = 'none';
   862|                    });
   863|
   864|                    // 添加当前标签的active类
   865|                    tab.classList.add('active');
   866|
   867|                    // 添加对应内容的active类
   868|                    const contentId = tab.getAttribute('data-category');
   869|                    const content = tabContents.querySelector(`.popup_tab_content[data-category="${contentId}"]`);
   870|                    if (content) {
   871|                        content.classList.add('active');
   872|                        content.style.display = 'flex';
   873|                        content.style.flexDirection = 'column';
   874|                    }
   875|
   876|                    // 改进滚动逻辑：确保选中的标签完全可见
   877|                    const tabRect = tab.getBoundingClientRect();
   878|                    const scrollRect = tabsScroll.getBoundingClientRect();
   879|
   880|                    // 检查标签是否完全在可视区域内
   881|                    const isFullyVisible =
   882|                        tabRect.left >= scrollRect.left &&
   883|                        tabRect.right <= scrollRect.right;
   884|
   885|                    if (!isFullyVisible) {
   886|                        // 如果标签在左侧不完全可见
   887|                        if (tabRect.left < scrollRect.left) {
   888|                            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
   889|                        }
   890|                        // 如果标签在右侧不完全可见
   891|                        else if (tabRect.right > scrollRect.right) {
   892|                            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
   893|                        }
   894|                    }
   895|                });
   896|
   897|                this.eventCleanups.push(tabClickCleanup);
   898|                tabs.appendChild(tab);
   899|
   900|                // 创建对应的内容区域
   901|                const content = document.createElement('div');
   902|                content.className = 'popup_tab_content';
   903|                content.setAttribute('data-category', category);
   904|                content.style.flex = '1';
   905|                content.style.display = 'none';
   906|                content.style.minHeight = '0'; // 允许flex收缩
   907|                content.style.overflow = 'auto'; // 确保内容溢出时显示滚动条
   908|
   909|                // 第一个内容默认显示
   910|                if (index === 0) {
   911|                    content.classList.add('active');
   912|                    content.style.display = 'flex';
   913|                    content.style.flexDirection = 'column';
   914|                }
   915|
   916|                // 获取该分类的数据
   917|                // 如果是"标签"虚拟分类（仅在没有实际分类时使用），使用根标签作为数据
   918|                const categoryData = category === "标签" ? rootTags : data[category];
   919|
   920|                if (typeof categoryData === 'object' && categoryData !== null) {
   921|                    // 使用 _createInnerAccordion，它已经支持混合内容（标签+子分类）
   922|                    const innerContent = this._createInnerAccordion(categoryData, '1', category, category);
   923|                    content.appendChild(innerContent);
   924|                }
   925|
   926|                tabContents.appendChild(content);
   927|            });
   928|
   929|            // ---在 Tab 栏末尾添加"New category"按钮---
   930|            const addTabButton = document.createElement('div');
   931|            addTabButton.className = 'popup_tab add_category_tab';
   932|            addTabButton.title = 'New category';
   933|
   934|            const addTabIcon = document.createElement('span');
   935|            addTabIcon.className = 'pi pi-plus';
   936|            addTabButton.appendChild(addTabIcon);
   937|
   938|            const addTabClickCleanup = EventManager.addDOMListener(addTabButton, 'click', (e) => {
   939|                e.stopPropagation();
   940|                this._handleAddCategory(addTabButton, null, tabs, tabContents, data);
   941|            });
   942|            this.eventCleanups.push(addTabClickCleanup);
   943|            tabs.appendChild(addTabButton);
   944|
   945|            // 组装标签页结构
   946|            tabsScroll.appendChild(tabs);
   947|            tabsContainer.appendChild(leftIndicator);
   948|            tabsContainer.appendChild(tabsScroll);
   949|            tabsContainer.appendChild(rightIndicator);
   950|
   951|            // 组装容器
   952|            container.appendChild(tabsContainer);
   953|            container.appendChild(tabContents);
   954|
   955|            return container;
   956|        } else {
   957|            // 非顶级分类使用普通容器
   958|            const container = document.createElement('div');
   959|            container.className = 'tag_category_container';
   960|            container.style.overflow = 'visible'; // 移除滚动条，让父容器处理
   961|
   962|            // 跟踪当前层级的第一个手风琴
   963|            let isFirstAccordionInLevel = true;
   964|
   965|            for (const [key, value] of Object.entries(data)) {
   966|                // 如果值是字符串，说明是标签
   967|                if (typeof value === 'string') {
   968|                    const tagItem = this._createTagElement(key, value, categoryName);
   969|                    container.appendChild(tagItem);
   970|                }
   971|                // 递归处理下一级
   972|                else if (typeof value === 'object' && value !== null) {
   973|                    const accordion = document.createElement('div');
   974|                    accordion.className = 'tag_accordion';
   975|                    accordion.setAttribute('data-category', key);
   976|                    accordion.setAttribute('data-level', level);
   977|
   978|                    const header = document.createElement('div');
   979|                    header.className = 'tag_accordion_header';
   980|
   981|                    const headerTitle = document.createElement('div');
   982|                    headerTitle.className = 'tag_accordion_title';
   983|                    headerTitle.textContent = key;
   984|
   985|                    const headerIcon = document.createElement('div');
   986|                    headerIcon.className = 'tag_accordion_icon';
   987|
   988|                    // 添加加号图标（创建新标签）
   989|                    const addIconSpan = document.createElement('span');
   990|                    addIconSpan.className = 'pi pi-plus accordion_add_icon';
   991|                    addIconSpan.title = 'Create a new tag in this category';
   992|                    headerIcon.appendChild(addIconSpan);
   993|
   994|                    // 添加箭头图标
   995|                    const arrowIconSpan = document.createElement('span');
   996|                    arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
   997|                    headerIcon.appendChild(arrowIconSpan);
   998|
   999|                    // 添加加号图标点击事件
  1000|                    const addIconCleanup = EventManager.addDOMListener(addIconSpan, 'click', (e) => {
  1001|                        e.stopPropagation(); // 阻止事件冒泡，避免触发手风琴展开/收起
  1002|                        this._handleAddTag(key, categoryName || key);
  1003|                    });
  1004|                    this.eventCleanups.push(addIconCleanup);
  1005|
  1006|                    header.appendChild(headerTitle);
  1007|                    header.appendChild(headerIcon);
  1008|
  1009|                    // 添加拖拽时自动展开功能
  1010|                    let hoverTimer = null;
  1011|                    const dragOverCleanup = EventManager.addDOMListener(header, 'dragover', (e) => {
  1012|                        e.preventDefault(); // 必须阻止默认行为才能响应 drop/dragover
  1013|                        // 检查是否有正在拖拽的标签
  1014|                        const draggingTag = document.querySelector('.tag_item.tag-dragging');
  1015|                        if (draggingTag && !header.classList.contains('active')) {
  1016|                            if (!hoverTimer) {
  1017|                                hoverTimer = setTimeout(() => {
  1018|                                    logger.debug(`[AutoExpand] 拖拽悬停自动展开: ${key}`);
  1019|                                    header.click();
  1020|                                    hoverTimer = null;
  1021|                                }, 500); // 500ms 延迟
  1022|                            }
  1023|                        }
  1024|                    });
  1025|
  1026|                    const dragLeaveCleanup = EventManager.addDOMListener(header, 'dragleave', () => {
  1027|                        if (hoverTimer) {
  1028|                            clearTimeout(hoverTimer);
  1029|                            hoverTimer = null;
  1030|                        }
  1031|                    });
  1032|                    // 还要处理 drop 事件，防止计时器残留
  1033|                    const dropCleanup = EventManager.addDOMListener(header, 'drop', () => {
  1034|                        if (hoverTimer) {
  1035|                            clearTimeout(hoverTimer);
  1036|                            hoverTimer = null;
  1037|                        }
  1038|                    });
  1039|
  1040|                    this.eventCleanups.push(dragOverCleanup, dragLeaveCleanup, dropCleanup);
  1041|
  1042|                    const content = document.createElement('div');
  1043|                    content.className = 'tag_accordion_content';
  1044|
  1045|                    // 递归创建子内容，传递 tabName
  1046|                    const childContent = this._createAccordionContent(value, (parseInt(level) + 1).toString(), tabName, key);
  1047|                    content.appendChild(childContent);
  1048|
  1049|                    // 根据保存的状态或默认行为确定是否展开
  1050|                    const accordionState = this.getAccordionState();
  1051|                    const shouldExpand = tabName && accordionState[tabName]?.[key] !== undefined
  1052|                        ? accordionState[tabName][key]  // 使用保存的状态
  1053|                        : isFirstAccordionInLevel;       // 默认展开第一个
  1054|
  1055|                    if (shouldExpand) {
  1056|                        header.classList.add('active');
  1057|                        content.classList.add('active');
  1058|                        const arrowIconSpan = headerIcon.querySelector('.accordion_arrow_icon');
  1059|                        if (arrowIconSpan) {
  1060|                            arrowIconSpan.classList.add('rotate-180');
  1061|                        }
  1062|                        if (!tabName || !accordionState[tabName]?.[key]) {
  1063|                            // 只有在使用默认行为时才更新标志
  1064|                            isFirstAccordionInLevel = false;
  1065|                        }
  1066|                    }
  1067|
  1068|                    // 添加手风琴切换事件
  1069|                    const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
  1070|                        e.stopPropagation();
  1071|
  1072|                        // 获取当前手风琴的层级
  1073|                        const currentLevel = accordion.getAttribute('data-level');
  1074|                        // 获取当前标签页下的所有同级手风琴
  1075|                        const parentTab = header.closest('.popup_tab_content');
  1076|                        if (parentTab) {
  1077|                            // 只关闭同级别的其他手风琴
  1078|                            const siblingAccordions = parentTab.querySelectorAll(`.tag_accordion[data-level="${currentLevel}"] .tag_accordion_header.active`);
  1079|                            if (!header.classList.contains('active')) {
  1080|                                siblingAccordions.forEach(otherHeader => {
  1081|                                    if (otherHeader !== header) {
  1082|                                        // 获取父级手风琴
  1083|                                        const parentAccordion = otherHeader.closest('.tag_accordion');
  1084|                                        // 确保是同级的手风琴
  1085|                                        if (parentAccordion && parentAccordion.getAttribute('data-level') === currentLevel) {
  1086|                                            const otherContent = otherHeader.nextElementSibling;
  1087|                                            const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
  1088|                                            // 使用优化的切换方法关闭其他手风琴
  1089|                                            if (otherHeader.classList.contains('active')) {
  1090|                                                this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
  1091|                                                // 保存关闭状态
  1092|                                                const otherAccordionCategory = parentAccordion.getAttribute('data-category');
  1093|                                                const otherTabName = parentTab.getAttribute('data-category');
  1094|                                                if (otherTabName && otherAccordionCategory) {
  1095|                                                    this.setAccordionState(otherTabName, otherAccordionCategory, false);
  1096|                                                }
  1097|                                            }
  1098|                                        }
  1099|                                    }
  1100|                                });
  1101|                            }
  1102|                        }
  1103|
  1104|                        // 使用优化的切换方法切换当前手风琴
  1105|                        this._toggleAccordion(header, content, headerIcon);
  1106|
  1107|                        // 保存当前手风琴状态
  1108|                        const accordionCategory = accordion.getAttribute('data-category');
  1109|                        const tabName = parentTab?.getAttribute('data-category');
  1110|                        if (tabName && accordionCategory) {
  1111|                            const isExpanded = header.classList.contains('active');
  1112|                            this.setAccordionState(tabName, accordionCategory, isExpanded);
  1113|                        }
  1114|                    });
  1115|
  1116|                    this.eventCleanups.push(accordionCleanup);
  1117|
  1118|                    accordion.appendChild(header);
  1119|                    accordion.appendChild(content);
  1120|                    container.appendChild(accordion);
  1121|                }
  1122|            }
  1123|
  1124|            // 初始化拖拽排序（如果有 Sortable）
  1125|            // 分别处理手风琴排序和标签排序
  1126|            if (this.Sortable) {
  1127|                // 检测容器内容类型
  1128|                const hasAccordions = container.querySelector(':scope > .tag_accordion') !== null;
  1129|                const hasTags = container.querySelector(':scope > .tag_item') !== null;
  1130|
  1131|                // 手风琴排序
  1132|                if (hasAccordions) {
  1133|                    const accordionSortable = new this.Sortable(container, {
  1134|                        group: { name: 'accordions', pull: false, put: false },
  1135|                        animation: 150,
  1136|                        ghostClass: 'tag-ghost',
  1137|                        handle: '.tag_accordion_header',
  1138|                        draggable: '.tag_accordion',
  1139|                        delay: 50,
  1140|                        onEnd: async (evt) => {
  1141|                            const { oldIndex, newIndex } = evt;
  1142|                            if (oldIndex === newIndex) return;
  1143|
  1144|                            const newOrderKeys = [];
  1145|                            Array.from(container.children).forEach(el => {
  1146|                                if (el.classList.contains('tag_accordion')) {
  1147|                                    const cat = el.getAttribute('data-category');
  1148|                                    if (cat) newOrderKeys.push(cat);
  1149|                                }
  1150|                            });
  1151|
  1152|                            const tempObj = { ...data };
  1153|                            for (const key in data) delete data[key];
  1154|
  1155|                            newOrderKeys.forEach(key => {
  1156|                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
  1157|                                    data[key] = tempObj[key];
  1158|                                }
  1159|                            });
  1160|
  1161|                            for (const key in tempObj) {
  1162|                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
  1163|                                    data[key] = tempObj[key];
  1164|                                }
  1165|                            }
  1166|
  1167|                            await this._saveTagOrder(data, tabName, categoryName);
  1168|                        }
  1169|                    });
  1170|                    this.sortables.push(accordionSortable);
  1171|                }
  1172|
  1173|                // 标签排序（支持跨分类拖拽）
  1174|                // 始终初始化标签 Sortable，确保空分类或只有子分类的容器也能接收标签
  1175|                if (true) {
  1176|                    // 为容器添加分类标识，用于跨分类拖拽时识别
  1177|                    container.setAttribute('data-sortable-category', categoryName || tabName);
  1178|                    // 确保容器有最小高度，以便空容器也能因 drop-zone 样式而被看到
  1179|                    container.style.minHeight = '10px';
  1180|
  1181|                    const tagSortable = new this.Sortable(container, {
  1182|                        group: {
  1183|                            name: 'tags',
  1184|                            pull: true,
  1185|                            put: function (to) {
  1186|                                // 如果目标容器包含手风琴，则不允许放入标签
  1187|                                return to.el.querySelector(':scope > .tag_accordion') === null;
  1188|                            }
  1189|                        }, // 允许跨分类拖拽
  1190|                        animation: 150,
  1191|                        ghostClass: 'tag-ghost',
  1192|                        draggable: '.tag_item',
  1193|                        delay: 50,
  1194|                        onStart: function (evt) {
  1195|                            evt.item.classList.add('tag-dragging');
  1196|                            // 高亮所有可放置的分类容器（仅限底层容器）
  1197|                            document.querySelectorAll('[data-sortable-category]').forEach(el => {
  1198|                                if (el !== evt.from && !el.querySelector(':scope > .tag_accordion')) {
  1199|                                    el.classList.add('tag-drop-zone');
  1200|                                }
  1201|                            });
  1202|                        },
  1203|                        onEnd: async (evt) => {
  1204|                            evt.item.classList.remove('tag-dragging');
  1205|                            // 移除高亮
  1206|                            document.querySelectorAll('.tag-drop-zone').forEach(el => {
  1207|                                el.classList.remove('tag-drop-zone');
  1208|                            });
  1209|
  1210|                            // 如果是跨分类移动，由 onAdd 处理
  1211|                            if (evt.from !== evt.to) return;
  1212|
  1213|                            const { oldIndex, newIndex } = evt;
  1214|                            if (oldIndex === newIndex) return;
  1215|
  1216|                            const newOrderKeys = [];
  1217|                            Array.from(container.children).forEach(el => {
  1218|                                if (el.classList.contains('tag_item')) {
  1219|                                    const name = el.getAttribute('data-name');
  1220|                                    if (name) newOrderKeys.push(name);
  1221|                                }
  1222|                            });
  1223|
  1224|                            const tempObj = { ...data };
  1225|                            for (const key in data) delete data[key];
  1226|
  1227|                            newOrderKeys.forEach(key => {
  1228|                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
  1229|                                    data[key] = tempObj[key];
  1230|                                }
  1231|                            });
  1232|
  1233|                            for (const key in tempObj) {
  1234|                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
  1235|                                    data[key] = tempObj[key];
  1236|                                }
  1237|                            }
  1238|
  1239|                            await this._saveTagOrder(data, tabName, categoryName);
  1240|                        },
  1241|                        onAdd: async (evt) => {
  1242|                            // 跨分类移动标签
  1243|                            const tagItem = evt.item;
  1244|                            const tagName = tagItem.getAttribute('data-name');
  1245|                            const tagValue = tagItem.getAttribute('data-value');
  1246|                            const fromCategory = evt.from.getAttribute('data-sortable-category');
  1247|                            const toCategory = evt.to.getAttribute('data-sortable-category');
  1248|
  1249|                            logger.debug(`[onAdd(root)] 开始移动标签: ${tagName}, 从: ${fromCategory}, 到: ${toCategory}`);
  1250|
  1251|                            // 更新标签元素的分类属性
  1252|                            tagItem.setAttribute('data-category', toCategory);
  1253|
  1254|                            // 调用移动函数 (不立即保存，等待排序)
  1255|                            const success = await this._moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, false);
  1256|
  1257|                            logger.debug(`[onAdd(root)] 移动结果: ${success}`);
  1258|
  1259|                            if (!success) {
  1260|                                // 如果移动失败，将标签移回原位置
  1261|                                logger.warn(`[onAdd(root)] 移动失败，回滚 DOM`);
  1262|                                evt.from.appendChild(tagItem);
  1263|                            } else {
  1264|                                // Move successful，现在根据 DOM 顺序重新排序并保存
  1265|
  1266|                                // 获取新的 DOM 顺序
  1267|                                const newOrderKeys = [];
  1268|                                Array.from(evt.to.children).forEach(el => {
  1269|                                    if (el.classList.contains('tag_item')) {
  1270|                                        const name = el.getAttribute('data-name');
  1271|                                        if (name) newOrderKeys.push(name);
  1272|                                    }
  1273|                                });
  1274|
  1275|                                // 重构 data 对象
  1276|                                const tempObj = { ...data };
  1277|                                for (const key in data) delete data[key];
  1278|
  1279|                                newOrderKeys.forEach(key => {
  1280|                                    if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
  1281|                                        data[key] = tempObj[key];
  1282|                                    }
  1283|                                });
  1284|
  1285|                                // 确保没有遗漏
  1286|                                for (const key in tempObj) {
  1287|                                    if (!Object.prototype.hasOwnProperty.call(data, key)) {
  1288|                                        data[key] = tempObj[key];
  1289|                                    }
  1290|                                }
  1291|
  1292|                                // 保存排序后的数据
  1293|                                await this._saveTagOrder(data, tabName, toCategory);
  1294|
  1295|                                // 显示成功提示
  1296|                                logger.debug(`[标签移动(root)] 成功并排序 | 标签: ${tagName} | 到: ${toCategory}`);
  1297|                                app.extensionManager.toast.add({
  1298|                                    severity: "success",
  1299|                                    summary: "Move successful",
  1300|                                    detail: `Tag "${tagName}" has been moved to "${toCategory}"`,
  1301|                                    life: 2000
  1302|                                });
  1303|                            }
  1304|                        }
  1305|                    });
  1306|                    this.sortables.push(tagSortable);
  1307|                }
  1308|            }
  1309|
  1310|            return container;
  1311|        }
  1312|    }
  1313|
  1314|    /**
  1315|     * 为二级分类创建手风琴元素
  1316|     */
  1317|    static _createAccordionElement(key, value, level) {
  1318|        const accordion = document.createElement('div');
  1319|        accordion.className = 'tag_accordion';
  1320|
  1321|        accordion.setAttribute('data-category', key);
  1322|
  1323|        const header = document.createElement('div');
  1324|        header.className = 'tag_accordion_header';
  1325|
  1326|        const headerTitle = document.createElement('div');
  1327|        headerTitle.className = 'tag_accordion_title';
  1328|        headerTitle.textContent = key;
  1329|
  1330|        const headerIcon = document.createElement('div');
  1331|        headerIcon.className = 'tag_accordion_icon';
  1332|
  1333|        // 创建图标元素
  1334|        const arrowIconSpan = document.createElement('span');
  1335|        arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
  1336|        headerIcon.appendChild(arrowIconSpan);
  1337|
  1338|        header.appendChild(headerTitle);
  1339|        header.appendChild(headerIcon);
  1340|
  1341|        const content = document.createElement('div');
  1342|        content.className = 'tag_accordion_content';
  1343|
  1344|        // 递归创建子内容
  1345|        const childContent = this._createInnerAccordion(data, (parseInt(level) + 1).toString(), tabName, categoryName);
  1346|        accordion.appendChild(childContent);
  1347|
  1348|        // 添加手风琴切换事件，包含关闭其他手风琴的逻辑
  1349|        const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
  1350|            e.stopPropagation();
  1351|            // 获取当前标签页下的所有手风琴
  1352|            const parentTab = header.closest('.popup_tab_content');
  1353|            if (parentTab) {
  1354|                if (!header.classList.contains('active')) {
  1355|                    const otherAccordions = parentTab.querySelectorAll('.tag_accordion_header.active');
  1356|                    otherAccordions.forEach(otherHeader => {
  1357|                        if (otherHeader !== header) {
  1358|                            otherHeader.classList.remove('active');
  1359|                            const otherContent = otherHeader.nextElementSibling;
  1360|                            if (otherContent && otherContent.classList.contains('active')) {
  1361|                                otherContent.classList.remove('active');
  1362|                            }
  1363|                            const otherIcon = otherHeader.querySelector('.accordion_arrow_icon');
  1364|                            if (otherIcon) {
  1365|                                otherIcon.classList.add('rotate-180');
  1366|                            }
  1367|                        }
  1368|                    });
  1369|                }
  1370|            }
  1371|            // 切换当前手风琴状态
  1372|            header.classList.toggle('active');
  1373|            content.classList.toggle('active');
  1374|            // 图标旋转
  1375|            const toggleArrowIcon = headerIcon.querySelector('.accordion_arrow_icon');
  1376|            if (toggleArrowIcon) {
  1377|                if (header.classList.contains('active')) {
  1378|                    toggleArrowIcon.classList.add('rotate-180');
  1379|                } else {
  1380|                    toggleArrowIcon.classList.remove('rotate-180');
  1381|                }
  1382|            }
  1383|        });
  1384|        this.eventCleanups.push(accordionCleanup);
  1385|
  1386|        accordion.appendChild(header);
  1387|        accordion.appendChild(content);
  1388|
  1389|        // 默认展开第一个手风琴（根据父元素的位置）
  1390|        if (accordion.parentElement && accordion.parentElement.firstChild === accordion) {
  1391|            header.classList.add('active');
  1392|            content.classList.add('active');
  1393|        }
  1394|
  1395|        return accordion;
  1396|    }
  1397|
  1398|    /**
  1399|     * 为二级分类创建内容
  1400|     * @param {Object} data 数据对象
  1401|     * @param {string} level 层级
  1402|     * @param {string} tabName 标签页名称（用于恢复状态）
  1403|     */
  1404|    static _createInnerAccordion(data, level, tabName = null, categoryName = null) {
  1405|        const container = document.createElement('div');
  1406|        container.className = 'tag_category_container';
  1407|        container.style.flex = '1';
  1408|        container.style.overflow = 'visible'; // 移除滚动条，让父容器处理
  1409|        container.style.minHeight = '0'; // 允许flex收缩
  1410|
  1411|        // 跟踪是否为第一个手风琴
  1412|        let isFirstAccordion = true;
  1413|
  1414|        for (const [key, value] of Object.entries(data)) {
  1415|            // 如果值是对象，创建新的手风琴
  1416|            if (typeof value === 'object' && value !== null) {
  1417|                const accordion = document.createElement('div');
  1418|                accordion.className = 'tag_accordion';
  1419|                accordion.setAttribute('data-category', key);
  1420|                const header = document.createElement('div');
  1421|                header.className = 'tag_accordion_header';
  1422|
  1423|                const headerTitle = document.createElement('div');
  1424|                headerTitle.className = 'tag_accordion_title';
  1425|                headerTitle.textContent = key;
  1426|
  1427|                const headerIcon = document.createElement('div');
  1428|                headerIcon.className = 'tag_accordion_icon';
  1429|
  1430|                // 添加加号图标（创建新标签）- 收藏页面不显示
  1431|                if (tabName !== 'favorites') {
  1432|                    const addIconSpan = document.createElement('span');
  1433|                    addIconSpan.className = 'pi pi-plus accordion_add_icon';
  1434|                    addIconSpan.title = 'Create a new tag in this category';
  1435|                    headerIcon.appendChild(addIconSpan);
  1436|
  1437|                    // 添加加号图标点击事件
  1438|                    const addIconCleanup = EventManager.addDOMListener(addIconSpan, 'click', (e) => {
  1439|                        e.stopPropagation(); // 阻止事件冒泡，避免触发手风琴展开/收起
  1440|                        this._handleAddTag(key, categoryName || key, addIconSpan);
  1441|                    });
  1442|                    this.eventCleanups.push(addIconCleanup);
  1443|                }
  1444|
  1445|                // 添加箭头图标
  1446|                const arrowIconSpan = document.createElement('span');
  1447|                arrowIconSpan.className = 'pi pi-chevron-down accordion_arrow_icon';
  1448|                headerIcon.appendChild(arrowIconSpan);
  1449|
  1450|                header.appendChild(headerTitle);
  1451|                header.appendChild(headerIcon);
  1452|
  1453|                // 添加右键菜单事件（收藏页面不显示）
  1454|                if (tabName !== 'favorites') {
  1455|                    const headerContextMenuCleanup = EventManager.addDOMListener(header, 'contextmenu', (e) => {
  1456|                        e.preventDefault();
  1457|                        e.stopPropagation();
  1458|                        this._showCategoryContextMenu(e, key, false, tabName);
  1459|                    });
  1460|                    this.eventCleanups.push(headerContextMenuCleanup);
  1461|                }
  1462|
  1463|                // 添加拖拽时自动展开功能
  1464|                let hoverTimer = null;
  1465|                const dragOverCleanup = EventManager.addDOMListener(header, 'dragover', (e) => {
  1466|                    e.preventDefault(); // 必须阻止默认行为才能响应 drop/dragover
  1467|                    // 检查是否有正在拖拽的标签
  1468|                    const draggingTag = document.querySelector('.tag_item.tag-dragging');
  1469|                    if (draggingTag && !header.classList.contains('active')) {
  1470|                        if (!hoverTimer) {
  1471|                            hoverTimer = setTimeout(() => {
  1472|                                logger.debug(`[AutoExpand] 拖拽悬停自动展开: ${key}`);
  1473|                                header.click();
  1474|                                hoverTimer = null;
  1475|                            }, 500); // 500ms 延迟
  1476|                        }
  1477|                    }
  1478|                });
  1479|
  1480|                const dragLeaveCleanup = EventManager.addDOMListener(header, 'dragleave', () => {
  1481|                    if (hoverTimer) {
  1482|                        clearTimeout(hoverTimer);
  1483|                        hoverTimer = null;
  1484|                    }
  1485|                });
  1486|                // 还要处理 drop 事件，防止计时器残留
  1487|                const dropCleanup = EventManager.addDOMListener(header, 'drop', () => {
  1488|                    if (hoverTimer) {
  1489|                        clearTimeout(hoverTimer);
  1490|                        hoverTimer = null;
  1491|                    }
  1492|                });
  1493|
  1494|                this.eventCleanups.push(dragOverCleanup, dragLeaveCleanup, dropCleanup);
  1495|
  1496|                const content = document.createElement('div');
  1497|                content.className = 'tag_accordion_content';
  1498|
  1499|                // 递归创建子内容
  1500|                // 传递当前手风琴的分类名称（key）作为 categoryName，而不是父分类名称
  1501|                // 这样每个容器的 data-sortable-category 才能正确标识其所属分类
  1502|                const childContent = this._createInnerAccordion(value, (parseInt(level) + 1).toString(), tabName, key);
  1503|                childContent.style.flex = '1'; // 让子内容占满可用空间
  1504|                childContent.style.minHeight = '0'; // 允许flex收缩
  1505|                content.appendChild(childContent);
  1506|
  1507|                // 根据保存的状态或默认行为确定是否展开
  1508|                let shouldExpand;
  1509|                const accordionState = this.getAccordionState();
  1510|
  1511|                if (tabName === 'favorites') {
  1512|                    // 收藏页特殊处理：默认展开当前CSV对应的分类
  1513|                    // 获取当前CSV文件名（无扩展名）
  1514|                    let currentCsvName = this.currentCsvFile || "";
  1515|                    currentCsvName = currentCsvName.replace(/\.(csv|json|yaml|yml)$/i, '');
  1516|
  1517|                    // 检查当前key是否匹配当前CSV (key就是分类名)
  1518|                    const isCurrentCsv = key === currentCsvName;
  1519|
  1520|                    // 检查是否存在匹配的分类
  1521|                    const hasCurrentCsv = Object.keys(data).includes(currentCsvName);
  1522|
  1523|                    // 如果当前Key匹配当前CSV，展开
  1524|                    // 或者如果没有对应的CSV分类，且这是第一个，展开
  1525|                    shouldExpand = isCurrentCsv || (!hasCurrentCsv && isFirstAccordion);
  1526|
  1527|                    // console.log(`[AutoExpand] Key: ${key}, Current: ${currentCsvName}, Match: ${isCurrentCsv}, HasCurrent: ${hasCurrentCsv}, Should: ${shouldExpand}`);
  1528|                } else {
  1529|                    // 普通页逻辑：优先使用保存状态，否则默认展开第一个
  1530|                    shouldExpand = tabName && accordionState[tabName]?.[key] !== undefined
  1531|                        ? accordionState[tabName][key]
  1532|                        : isFirstAccordion;
  1533|                }
  1534|
  1535|                if (shouldExpand) {
  1536|                    header.classList.add('active');
  1537|                    content.classList.add('active');
  1538|                    const firstArrowIcon = headerIcon.querySelector('.pi.pi-chevron-down');
  1539|                    if (firstArrowIcon) {
  1540|                        firstArrowIcon.classList.add('rotate-180');
  1541|                    }
  1542|                    if (!tabName || !accordionState[tabName]?.[key]) {
  1543|                        // 只有在使用默认行为时才更新标志
  1544|                        isFirstAccordion = false;
  1545|                    }
  1546|                }
  1547|
  1548|                // 添加手风琴切换事件，包含关闭同级其他手风琴的逻辑
  1549|                const accordionCleanup = EventManager.addDOMListener(header, 'click', (e) => {
  1550|                    e.stopPropagation();
  1551|
  1552|                    // 获取当前手风琴的父容器（而不是整个标签页）
  1553|                    const parentContainer = accordion.parentElement;
  1554|                    const parentTab = header.closest('.popup_tab_content');
  1555|
  1556|                    if (parentContainer) {
  1557|                        if (!header.classList.contains('active')) {
  1558|                            // 只查找同一父容器内的直接子手风琴（同级手风琴），而不是所有层级
  1559|                            const siblingAccordions = parentContainer.querySelectorAll(':scope > .tag_accordion > .tag_accordion_header.active');
  1560|                            siblingAccordions.forEach(otherHeader => {
  1561|                                if (otherHeader !== header) {
  1562|                                    const otherContent = otherHeader.nextElementSibling;
  1563|                                    const otherHeaderIcon = otherHeader.querySelector('.tag_accordion_icon');
  1564|                                    // 使用优化的切换方法关闭同级其他手风琴
  1565|                                    if (otherHeader.classList.contains('active')) {
  1566|                                        this._toggleAccordion(otherHeader, otherContent, otherHeaderIcon);
  1567|                                        // 保存关闭状态
  1568|                                        const otherAccordion = otherHeader.closest('.tag_accordion');
  1569|                                        const otherAccordionCategory = otherAccordion?.getAttribute('data-category');
  1570|                                        const tabName = parentTab?.getAttribute('data-category');
  1571|                                        if (tabName && otherAccordionCategory) {
  1572|                                            this.setAccordionState(tabName, otherAccordionCategory, false);
  1573|                                        }
  1574|                                    }
  1575|                                }
  1576|                            });
  1577|                        }
  1578|                    }
  1579|                    // 使用优化的切换方法切换当前手风琴
  1580|                    this._toggleAccordion(header, content, headerIcon);
  1581|
  1582|                    // 保存当前手风琴状态
  1583|                    const accordionCategory = accordion.getAttribute('data-category');
  1584|                    const tabName = parentTab?.getAttribute('data-category');
  1585|                    if (tabName && accordionCategory) {
  1586|                        const isExpanded = header.classList.contains('active');
  1587|                        this.setAccordionState(tabName, accordionCategory, isExpanded);
  1588|                    }
  1589|                });
  1590|
  1591|                this.eventCleanups.push(accordionCleanup);
  1592|
  1593|                accordion.appendChild(header);
  1594|                accordion.appendChild(content);
  1595|                container.appendChild(accordion);
  1596|            } else if (typeof value === 'string') {
  1597|                // 如果值是字符串，创建标签项
  1598|                const tagItem = this._createTagElement(key, value, categoryName);
  1599|                container.appendChild(tagItem);
  1600|            }
  1601|        }
  1602|
  1603|        // ---在手风琴列表末尾添加"New subcategory"按钮（仅限 level='1'，即第一级手风琴）---
  1604|        if (level === '1' && tabName !== 'favorites') {
  1605|            const addSubCategoryBtn = document.createElement('div');
  1606|            addSubCategoryBtn.className = 'add_subcategory_button';
  1607|            addSubCategoryBtn.title = 'New subcategory';
  1608|
  1609|            const addSubCategoryIcon = document.createElement('span');
  1610|            addSubCategoryIcon.className = 'pi pi-plus';
  1611|            addSubCategoryBtn.appendChild(addSubCategoryIcon);
  1612|
  1613|            const addSubCategoryClickCleanup = EventManager.addDOMListener(addSubCategoryBtn, 'click', (e) => {
  1614|                e.stopPropagation();
  1615|                this._handleAddCategory(addSubCategoryBtn, tabName, null, null, data, categoryName);
  1616|            });
  1617|            this.eventCleanups.push(addSubCategoryClickCleanup);
  1618|            container.appendChild(addSubCategoryBtn);
  1619|        }
  1620|
  1621|        // 初始化拖拽排序（如果有 Sortable）
  1622|        // 分别处理手风琴排序和标签排序，避免拖拽标签时误触发手风琴排序
  1623|        if (this.Sortable) {
  1624|            // 检测容器内容类型（只检测直接子元素）
  1625|            const hasAccordions = container.querySelector(':scope > .tag_accordion') !== null;
  1626|            const hasTags = container.querySelector(':scope > .tag_item') !== null;
  1627|
  1628|            // 手风琴排序：只有手风琴头部可以触发，且只排序手风琴元素
  1629|            if (hasAccordions) {
  1630|                const accordionSortable = new this.Sortable(container, {
  1631|                    group: { name: 'accordions', pull: false, put: false }, // 独立分组，不与标签混排
  1632|                    animation: 150,
  1633|                    ghostClass: 'tag-ghost',
  1634|                    handle: '.tag_accordion_header', // 只有手风琴头部可以拖拽
  1635|                    draggable: '.tag_accordion', // 只排序手风琴元素
  1636|                    delay: 50,
  1637|                    onEnd: async (evt) => {
  1638|                        const { oldIndex, newIndex } = evt;
  1639|                        if (oldIndex === newIndex) return;
  1640|
  1641|                        // 获取新顺序（只处理手风琴）
  1642|                        const newOrderKeys = [];
  1643|                        Array.from(container.children).forEach(el => {
  1644|                            if (el.classList.contains('tag_accordion')) {
  1645|                                const cat = el.getAttribute('data-category');
  1646|                                if (cat) newOrderKeys.push(cat);
  1647|                            }
  1648|                        });
  1649|
  1650|                        // 重构 data 对象
  1651|                        const tempObj = { ...data };
  1652|                        for (const key in data) delete data[key];
  1653|
  1654|                        newOrderKeys.forEach(key => {
  1655|                            if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
  1656|                                data[key] = tempObj[key];
  1657|                            }
  1658|                        });
  1659|
  1660|                        // 保留未在DOM中的数据
  1661|                        for (const key in tempObj) {
  1662|                            if (!Object.prototype.hasOwnProperty.call(data, key)) {
  1663|                                data[key] = tempObj[key];
  1664|                            }
  1665|                        }
  1666|
  1667|                        // 保存排序
  1668|                        await this._saveTagOrder(data, tabName, categoryName);
  1669|                    }
  1670|                });
  1671|                this.sortables.push(accordionSortable);
  1672|            }
  1673|
  1674|
  1675|            // 标签排序（支持跨分类拖拽）
  1676|            // 始终初始化标签 Sortable，确保空分类或只有子分类的容器也能接收标签
  1677|            if (true) {
  1678|                // 为容器添加分类标识，用于跨分类拖拽时识别
  1679|                container.setAttribute('data-sortable-category', categoryName || tabName);
  1680|                // 确保容器有最小高度，以便空容器也能因 drop-zone 样式而被看到
  1681|                container.style.minHeight = '10px';
  1682|
  1683|                const tagSortable = new this.Sortable(container, {
  1684|                    group: {
  1685|                        name: 'tags',
  1686|                        pull: true,
  1687|                        put: function (to) {
  1688|                            // 如果目标容器包含手风琴（由 .tag_accordion 子元素判断），则不允许放入标签
  1689|                            // 标签只能放入最底层的分类容器（即手风琴的内容区域）
  1690|                            return to.el.querySelector(':scope > .tag_accordion') === null;
  1691|                        }
  1692|                    }, // 允许跨分类拖拽
  1693|                    animation: 150,
  1694|                    ghostClass: 'tag-ghost',
  1695|                    draggable: '.tag_item',
  1696|                    delay: 50,
  1697|                    onStart: function (evt) {
  1698|                        evt.item.classList.add('tag-dragging');
  1699|                        // 高亮所有可放置的分类容器（仅限底层容器）
  1700|                        document.querySelectorAll('[data-sortable-category]').forEach(el => {
  1701|                            if (el !== evt.from && !el.querySelector(':scope > .tag_accordion')) {
  1702|                                el.classList.add('tag-drop-zone');
  1703|                            }
  1704|                        });
  1705|                    },
  1706|                    onEnd: async (evt) => {
  1707|                        evt.item.classList.remove('tag-dragging');
  1708|                        // 移除高亮
  1709|                        document.querySelectorAll('.tag-drop-zone').forEach(el => {
  1710|                            el.classList.remove('tag-drop-zone');
  1711|                        });
  1712|
  1713|                        // 如果是跨分类移动，由 onAdd 处理
  1714|                        if (evt.from !== evt.to) return;
  1715|
  1716|                        const { oldIndex, newIndex } = evt;
  1717|                        if (oldIndex === newIndex) return;
  1718|
  1719|                        const newOrderKeys = [];
  1720|                        Array.from(container.children).forEach(el => {
  1721|                            if (el.classList.contains('tag_item')) {
  1722|                                const name = el.getAttribute('data-name');
  1723|                                if (name) newOrderKeys.push(name);
  1724|                            }
  1725|                        });
  1726|
  1727|                        const tempObj = { ...data };
  1728|                        for (const key in data) delete data[key];
  1729|
  1730|                        // 先添加排序后的标签
  1731|                        newOrderKeys.forEach(key => {
  1732|                            if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
  1733|                                data[key] = tempObj[key];
  1734|                            }
  1735|                        });
  1736|
  1737|                        // 补回其他键（即该层级下的子分类）
  1738|                        for (const key in tempObj) {
  1739|                            if (!Object.prototype.hasOwnProperty.call(data, key)) {
  1740|                                data[key] = tempObj[key];
  1741|                            }
  1742|                        }
  1743|
  1744|                        await this._saveTagOrder(data, tabName, categoryName);
  1745|                    },
  1746|                    onAdd: async (evt) => {
  1747|                        // 跨分类移动标签
  1748|                        const tagItem = evt.item;
  1749|                        const tagName = tagItem.getAttribute('data-name');
  1750|                        const tagValue = tagItem.getAttribute('data-value');
  1751|                        const fromCategory = evt.from.getAttribute('data-sortable-category');
  1752|                        const toCategory = evt.to.getAttribute('data-sortable-category');
  1753|
  1754|                        logger.debug(`[onAdd] 开始移动标签: ${tagName}, 从: ${fromCategory}, 到: ${toCategory}`);
  1755|
  1756|                        // 更新标签元素的分类属性
  1757|                        tagItem.setAttribute('data-category', toCategory);
  1758|
  1759|                        // 调用移动函数 (不立即保存，等待排序)
  1760|                        const success = await this._moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, false);
  1761|
  1762|                        logger.debug(`[onAdd] 移动结果: ${success}`);
  1763|
  1764|                        if (!success) {
  1765|                            // 如果移动失败，将标签移回原位置
  1766|                            logger.warn(`[onAdd] 移动失败，回滚 DOM`);
  1767|                            evt.from.appendChild(tagItem);
  1768|                        } else {
  1769|                            // Move successful，现在根据 DOM 顺序重新排序并保存
  1770|
  1771|                            // 获取新的 DOM 顺序
  1772|                            const newOrderKeys = [];
  1773|                            Array.from(evt.to.children).forEach(el => {
  1774|                                if (el.classList.contains('tag_item')) {
  1775|                                    const name = el.getAttribute('data-name');
  1776|                                    if (name) newOrderKeys.push(name);
  1777|                                }
  1778|                            });
  1779|
  1780|                            // 重构 data 对象
  1781|                            const tempObj = { ...data };
  1782|                            for (const key in data) delete data[key];
  1783|
  1784|                            // 先添加排序后的标签
  1785|                            newOrderKeys.forEach(key => {
  1786|                                if (Object.prototype.hasOwnProperty.call(tempObj, key)) {
  1787|                                    data[key] = tempObj[key];
  1788|                                }
  1789|                            });
  1790|
  1791|                            // 补回其他键（即该层级下的子分类/原本就在此处的子分类）
  1792|                            for (const key in tempObj) {
  1793|                                if (!Object.prototype.hasOwnProperty.call(data, key)) {
  1794|                                    data[key] = tempObj[key];
  1795|                                }
  1796|                            }
  1797|
  1798|
  1799|                            // 保存排序后的数据
  1800|                            await this._saveTagOrder(data, tabName, toCategory);
  1801|
  1802|                            // 显示成功提示
  1803|                            logger.debug(`[标签移动] 成功并排序 | 标签: ${tagName} | 到: ${toCategory}`);
  1804|                            app.extensionManager.toast.add({
  1805|                                severity: "success",
  1806|                                summary: "Move successful",
  1807|                                detail: `Tag "${tagName}" has been moved to "${toCategory}"`,
  1808|                                life: 2000
  1809|                            });
  1810|                        }
  1811|                    }
  1812|                });
  1813|                this.sortables.push(tagSortable);
  1814|            }
  1815|        }
  1816|
  1817|        return container;
  1818|    }
  1819|
  1820|    /**
  1821|     * 保存标签排序
  1822|     * @param {Object} data 数据对象
  1823|     * @param {string} tabName 标签页名称
  1824|     * @param {string} categoryName 分类名称
  1825|     */
  1826|    static async _saveTagOrder(data, tabName, categoryName) {
  1827|        try {
  1828|            let success = false;
  1829|            const isFavorites = tabName === 'favorites' || categoryName === 'favorites';
  1830|
  1831|            if (isFavorites) {
  1832|                // 保存到 tags_user.json
  1833|                const userTagData = await ResourceManager.getUserTagData();
  1834|                if (!userTagData.favorites) {
  1835|                    userTagData.favorites = {};
  1836|                }
  1837|                userTagData.favorites = TagManager.favorites;
  1838|
  1839|                success = await ResourceManager.saveUserTags(userTagData);
  1840|                if (success) {
  1841|                    logger.debug(`[标签排序] 收藏排序已保存`);
  1842|                    app.extensionManager.toast.add({
  1843|                        severity: "success",
  1844|                        summary: "Order saved successfully",
  1845|                        detail: "Favorites tag order updated",
  1846|                        life: 2000
  1847|                    });
  1848|                }
  1849|            } else {
  1850|                // 保存到 CSV
  1851|                if (TagManager.currentCsvFile && TagManager.tagData) {
  1852|                    success = await ResourceManager.saveTagsCsv(TagManager.currentCsvFile, TagManager.tagData);
  1853|                    if (success) {
  1854|                        logger.debug(`[标签排序] CSV排序已保存 | 文件: ${TagManager.currentCsvFile}`);
  1855|                        app.extensionManager.toast.add({
  1856|                            severity: "success",
  1857|                            summary: "Order saved successfully",
  1858|                            detail: "Tag file order updated",
  1859|                            life: 2000
  1860|                        });
  1861|                    }
  1862|                }
  1863|            }
  1864|
  1865|            if (!success) {
  1866|                app.extensionManager.toast.add({
  1867|                    severity: "error",
  1868|                    summary: "Save failed",
  1869|                    detail: "Order could not be saved to the server",
  1870|                    life: 3000
  1871|                });
  1872|            }
  1873|        } catch (err) {
  1874|            logger.error(`[标签排序] 保存出错: ${err.message}`);
  1875|        }
  1876|    }
  1877|
  1878|    /**
  1879|     * 移动标签到新分类
  1880|     * @param {string} tagName 标签名称
  1881|     * @param {string} tagValue 标签值
  1882|     * @param {string} fromCategory 原分类名
  1883|     * @param {string} toCategory 目标分类名
  1884|     * @param {string} tabName 标签页名称
  1885|     */
  1886|    static async _moveTagToCategory(tagName, tagValue, fromCategory, toCategory, tabName, shouldSave = true) {
  1887|        try {
  1888|            // 收藏页不支持跨分类移动
  1889|            if (tabName === 'favorites' || fromCategory === 'favorites' || toCategory === 'favorites') {
  1890|                logger.debug('[标签移动] 收藏页标签不支持跨分类移动');
  1891|                return false;
  1892|            }
  1893|
  1894|            // 如果源分类和目标分类相同，不处理
  1895|            if (fromCategory === toCategory) {
  1896|                return false;
  1897|            }
  1898|
  1899|            const filename = this.currentCsvFile;
  1900|            if (!filename || !TagManager.tagData) {
  1901|                logger.error('[标签移动] 无法获取当前CSV文件或标签数据');
  1902|                return false;
  1903|            }
  1904|
  1905|            // 获取源分类和目标分类
  1906|            const sourceCategory = TagManager._findCategoryRecursively(TagManager.tagData, fromCategory);
  1907|            const targetCategory = TagManager._findCategoryRecursively(TagManager.tagData, toCategory);
  1908|
  1909|            if (!sourceCategory) {
  1910|                logger.error(`[标签移动] 找不到源分类: ${fromCategory}`);
  1911|                return false;
  1912|            }
  1913|
  1914|            if (!targetCategory) {
  1915|                logger.error(`[标签移动] 找不到目标分类: ${toCategory}`);
  1916|                return false;
  1917|            }
  1918|
  1919|            // 检查目标分类是否已存在同名标签
  1920|            if (targetCategory.hasOwnProperty(tagName)) {
  1921|                app.extensionManager.toast.add({
  1922|                    severity: "warn",
  1923|                    summary: "移动失败",
  1924|                    detail: `目标分类中已存在同名标签 "${tagName}"`,
  1925|                    life: 3000
  1926|                });
  1927|                return false;
  1928|            }
  1929|
  1930|            // 从源分类删除标签
  1931|            delete sourceCategory[tagName];
  1932|
  1933|            // 添加到目标分类
  1934|            targetCategory[tagName] = tagValue;
  1935|
  1936|            if (!shouldSave) {
  1937|                return true;
  1938|            }
  1939|
  1940|            // 保存到 CSV
  1941|            const success = await ResourceManager.saveTagsCsv(filename, TagManager.tagData);
  1942|
  1943|            if (success) {
  1944|                logger.debug(`[标签移动] 成功 | 标签: ${tagName} | 从: ${fromCategory} | 到: ${toCategory}`);
  1945|                app.extensionManager.toast.add({
  1946|                    severity: "success",
  1947|                    summary: "Move successful",
  1948|                    detail: `Tag "${tagName}" has been moved to "${toCategory}"`,
  1949|                    life: 2000
  1950|                });
  1951|                return true;
  1952|            } else {
  1953|                // 回滚操作
  1954|                targetCategory[tagName] && delete targetCategory[tagName];
  1955|                sourceCategory[tagName] = tagValue;
  1956|
  1957|                app.extensionManager.toast.add({
  1958|                    severity: "error",
  1959|                    summary: "移动失败",
  1960|                    detail: "Failed to save to the server",
  1961|                    life: 3000
  1962|                });
  1963|                return false;
  1964|            }
  1965|        } catch (err) {
  1966|            logger.error(`[标签移动] 出错: ${err.message}`);
  1967|            app.extensionManager.toast.add({
  1968|                severity: "error",
  1969|                summary: "移动失败",
  1970|                detail: err.message,
  1971|                life: 3000
  1972|            });
  1973|            return false;
  1974|        }
  1975|    }
  1976|
  1977|    /**
  1978|     * 检查标签是否已收藏
  1979|     */
  1980|    static _isTagFavorited(tagValue, category = null) {
  1981|        if (!this.favorites) return false;
  1982|
  1983|        // 如果提供了分类，优先检查该分类
  1984|        if (category) {
  1985|            // 标准化分类名称（去除扩展名）
  1986|            const normalize = (name) => name.replace(/\.(csv|json|yaml|yml)$/i, '');
  1987|            const targetCat = normalize(category);
  1988|
  1989|            // 检查直接匹配
  1990|            if (this.favorites[targetCat]) {
  1991|                return Object.values(this.favorites[targetCat]).includes(tagValue);
  1992|            }
  1993|
  1994|            // 如果没找到直接匹配的Key，可能需要遍历Keys进行模糊匹配?
  1995|            // 目前假设 Keys 都是已标准化。
  1996|            // 但如果 favorites 还是旧结构（平铺），直接检查 values
  1997|            const isOldStructure = Object.values(this.favorites).some(v => typeof v !== 'object');
  1998|            if (isOldStructure) {
  1999|                // 旧结构忽略 category
  2000|                return Object.values(this.favorites).includes(tagValue);
  2001|