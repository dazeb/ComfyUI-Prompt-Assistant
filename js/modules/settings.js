     1|/**
     2| * 小助手设置服务
     3| * 负责管理小助手的设置选项，提供开关控制功能
     4| */
     5|
     6|import { app } from "../../../../scripts/app.js";
     7|import { logger } from '../utils/logger.js';
     8|import { PromptAssistant } from "./PromptAssistant.js";
     9|import { ImageCaption } from "./imageCaption.js";
    10|import { EventManager } from "../utils/eventManager.js";
    11|import { ResourceManager } from "../utils/resourceManager.js";
    12|import { HistoryCacheService, TagCacheService, TranslateCacheService, CACHE_CONFIG } from "../services/cache.js";
    13|import { UIToolkit } from "../utils/UIToolkit.js";
    14|import { FEATURES, handleFeatureChange } from "../services/features.js";
    15|import { APIService } from "../services/api.js";
    16|import {
    17|    UI_LANGUAGE_SETTING_ID,
    18|    getStoredUiLanguage,
    19|    persistUiLanguage,
    20|    ensureUiLocaleLoaded,
    21|    tUI,
    22|    patchToastLocalization,
    23|    syncGlobalUiLocalization,
    24|    LANGUAGE_OPTIONS
    25|} from "../utils/uiI18n.js";
    26|
    27|import { apiConfigManager } from "./apiConfigManager.js";
    28|import { rulesConfigManager } from "./rulesConfigManager.js";
    29|import {
    30|    createSettingsDialog,
    31|    closeModalWithAnimation,
    32|    createFormGroup,
    33|    createInputGroup,
    34|    createSelectGroup,
    35|    createHorizontalFormGroup,
    36|    createLoadingButton
    37|} from "./uiComponents.js";
    38|
    39|// 标记是否是首次加载页面
    40|let isFirstLoad = true;
    41|
    42|function localizeSettingsPayload(payload) {
    43|    if (Array.isArray(payload)) {
    44|        return payload.map(item => localizeSettingsPayload(item));
    45|    }
    46|
    47|    if (!payload || typeof payload !== "object") {
    48|        return payload;
    49|    }
    50|
    51|    const localized = {};
    52|    for (const [key, value] of Object.entries(payload)) {
    53|        if (key === "category" && Array.isArray(value)) {
    54|            localized[key] = value.map(item => tUI(item, item));
    55|            continue;
    56|        }
    57|
    58|        if (["name", "tooltip", "text", "summary", "detail"].includes(key) && typeof value === "string") {
    59|            localized[key] = tUI(value, value);
    60|            continue;
    61|        }
    62|
    63|        if (typeof value === "function") {
    64|            localized[key] = value;
    65|            continue;
    66|        }
    67|
    68|        localized[key] = localizeSettingsPayload(value);
    69|    }
    70|
    71|    return localized;
    72|}
    73|
    74|// ---服务选择器配置---
    75|const SERVICE_TYPES = {
    76|    translate: {
    77|        name: tUI('Translation'),
    78|        configEndpoint: '/config/translate',
    79|        serviceType: 'translate',
    80|        filterKey: 'llm_models',
    81|        includeBaidu: true
    82|    },
    83|    llm: {
    84|        name: tUI('Prompt optimization'),
    85|        configEndpoint: '/config/llm',
    86|        serviceType: 'llm',
    87|        filterKey: 'llm_models',
    88|        includeBaidu: false
    89|    },
    90|    vlm: {
    91|        name: tUI('Image caption'),
    92|        configEndpoint: '/config/vision',
    93|        serviceType: 'vlm',
    94|        filterKey: 'vlm_models',
    95|        includeBaidu: false
    96|    }
    97|};
    98|
    99|// ---服务选择器---
   100|const serviceSelector = {
   101|    _servicesCache: null,
   102|    _cacheTime: 0,
   103|    _cacheDuration: 2000, // 缓存2秒
   104|
   105|    /**
   106|     * 清除服务缓存
   107|     */
   108|    clearCache() {
   109|        this._servicesCache = null;
   110|        this._cacheTime = 0;
   111|        logger.debug('服务列表缓存已清除');
   112|    },
   113|
   114|    // 获取服务列表（带缓存）
   115|    async getServices(forceRefresh = false) {
   116|        const now = Date.now();
   117|        if (!forceRefresh && this._servicesCache && (now - this._cacheTime) < this._cacheDuration) {
   118|            return this._servicesCache;
   119|        }
   120|
   121|        try {
   122|            const response = await fetch(APIService.getApiUrl('/services'));
   123|            if (response.ok) {
   124|                const data = await response.json();
   125|                if (data.success) {
   126|                    this._servicesCache = data.services || [];
   127|                    this._cacheTime = now;
   128|                    return this._servicesCache;
   129|                }
   130|            }
   131|        } catch (error) {
   132|            logger.error(`Failed to fetch service list: ${error.message}`);
   133|        }
   134|        return [];
   135|    },
   136|
   137|    // 获取指定类型的当前服务ID
   138|    async getCurrentService(type) {
   139|        const config = SERVICE_TYPES[type];
   140|        if (!config) return null;
   141|
   142|        try {
   143|            const response = await fetch(APIService.getApiUrl(config.configEndpoint));
   144|            if (response.ok) {
   145|                const data = await response.json();
   146|                return data.provider || null;
   147|            }
   148|        } catch (error) {
   149|            logger.error(`Failed to get current ${config.name} service: ${error.message}`);
   150|        }
   151|        return null;
   152|    },
   153|
   154|    // 设置指定类型的服务
   155|    async setCurrentService(type, serviceId) {
   156|        const config = SERVICE_TYPES[type];
   157|        if (!config) return false;
   158|
   159|        try {
   160|            const response = await fetch(APIService.getApiUrl('/services/current'), {
   161|                method: 'POST',
   162|                headers: { 'Content-Type': 'application/json' },
   163|                body: JSON.stringify({
   164|                    service_type: config.serviceType,
   165|                    service_id: serviceId
   166|                })
   167|            });
   168|
   169|            if (response.ok) {
   170|                logger.log(`${config.name} service switch | Service ID: ${serviceId}`);
   171|
   172|                // 派发全局事件通知其他组件同步
   173|                window.dispatchEvent(new CustomEvent('pa-service-changed', {
   174|                    detail: { service_type: config.serviceType, service_id: serviceId }
   175|                }));
   176|
   177|                return true;
   178|            }
   179|        } catch (error) {
   180|            logger.error(`Failed to switch ${config.name} service: ${error.message}`);
   181|        }
   182|        return false;
   183|    },
   184|
   185|    // 获取指定类型可用的服务选项列表
   186|    async getServiceOptions(type) {
   187|        const config = SERVICE_TYPES[type];
   188|        if (!config) return [];
   189|
   190|        const services = await this.getServices();
   191|        const options = [];
   192|
   193|        // 添加百度Translation选项（仅Translation类型）
   194|        if (config.includeBaidu) {
   195|            options.push({ value: 'baidu', text: tUI('Baidu Translation') });
   196|        }
   197|
   198|        // 过滤并添加其他服务
   199|        services
   200|            .filter(service => {
   201|                const models = service[config.filterKey];
   202|                return models && models.length > 0;
   203|            })
   204|            .forEach(service => {
   205|                options.push({
   206|                    value: service.id,
   207|                    text: service.name || service.id
   208|                });
   209|            });
   210|
   211|        return options;
   212|    }
   213|};
   214|
   215|// 将服务选择器挂载到全局 app 对象，方便其他模块（如 PromptAssistant.js, imageCaption.js）调用，
   216|// 同时避免模块间的循环引用问题。
   217|app.paServiceSelector = serviceSelector;
   218|
   219|// ---版本检查工具函数---
   220|
   221|// 版本检查状态缓存
   222|let versionCheckCache = {
   223|    checked: false,        // 是否已检查过
   224|    latestVersion: null,   // 最新版本号
   225|    hasUpdate: false       // 是否有更新
   226|};
   227|
   228|/**
   229| * 从 jsDelivr 获取最新版本号（通过读取 pyproject.toml）
   230| * @returns {Promise<string|null>} 返回最新版本号，格式如 "1.2.3"，失败返回 null
   231| */
   232|async function fetchLatestVersion() {
   233|    // 如果已经检查过，直接返回缓存结果
   234|    if (versionCheckCache.checked) {
   235|        return versionCheckCache.latestVersion;
   236|    }
   237|
   238|    try {
   239|        const response = await fetch('https://cdn.jsdelivr.net/gh/yawiii/ComfyUI-Prompt-Assistant@main/pyproject.toml', {
   240|            cache: 'no-cache'
   241|        });
   242|
   243|        if (!response.ok) {
   244|            logger.warn(`[Version check] Request failed: ${response.status}`);
   245|            versionCheckCache.checked = true;
   246|            return null;
   247|        }
   248|
   249|        const tomlContent = await response.text();
   250|        const versionMatch = tomlContent.match(/^version\s*=\s*["']([^"']+)["']/m);
   251|        const version = versionMatch ? versionMatch[1] : null;
   252|
   253|        // 缓存检查结果
   254|        versionCheckCache.checked = true;
   255|        versionCheckCache.latestVersion = version;
   256|
   257|        return version;
   258|    } catch (error) {
   259|        logger.warn(`[Version check] Fetch failed: ${error.message}`);
   260|        versionCheckCache.checked = true;
   261|        return null;
   262|    }
   263|}
   264|
   265|/**
   266| * 比较两 items版本号
   267| * @param {string} v1 - 第一 items版本号
   268| * @param {string} v2 - 第二 items版本号
   269| * @returns {number} v1 > v2 返回 1，v1 < v2 返回 -1，v1 === v2 返回 0
   270| */
   271|function compareVersion(v1, v2) {
   272|    // 将版本号分割为数字数组
   273|    const parts1 = v1.split('.').map(n => parseInt(n, 10) || 0);
   274|    const parts2 = v2.split('.').map(n => parseInt(n, 10) || 0);
   275|
   276|    // 确保两 items数组长度相同
   277|    const maxLength = Math.max(parts1.length, parts2.length);
   278|
   279|    for (let i = 0; i < maxLength; i++) {
   280|        const num1 = parts1[i] || 0;
   281|        const num2 = parts2[i] || 0;
   282|
   283|        if (num1 > num2) return 1;
   284|        if (num1 < num2) return -1;
   285|    }
   286|
   287|    return 0;
   288|}
   289|
   290|
   291|// ====================== 设置管理 ======================
   292|
   293|/**
   294| * 显示API Configuration弹窗
   295| */
   296|function showAPIConfigModal() {
   297|    try {
   298|        // 调用API Configuration管理器的显示弹窗方法
   299|        apiConfigManager.showAPIConfigModal();
   300|    } catch (error) {
   301|        logger.error(`Failed to open API config dialog: ${error.message}`);
   302|        app.extensionManager.toast.add({
   303|            severity: "error",
   304|            summary: tUI("Failed to open configuration"),
   305|            detail: error.message || tUI("An error occurred while opening the config dialog"),
   306|            life: 3000
   307|        });
   308|    }
   309|}
   310|
   311|/**
   312| * 显示Rules配置弹窗
   313| */
   314|function showRulesConfigModal() {
   315|    try {
   316|        // 调用Rules配置管理器的显示弹窗方法
   317|        rulesConfigManager.showRulesConfigModal();
   318|    } catch (error) {
   319|        logger.error(`Failed to open rules config dialog: ${error.message}`);
   320|        app.extensionManager.toast.add({
   321|            severity: "error",
   322|            summary: tUI("Failed to open configuration"),
   323|            detail: error.message || tUI("An error occurred while opening the config dialog"),
   324|            life: 3000
   325|        });
   326|    }
   327|}
   328|
   329|/**
   330| * 创建服务选择器下拉框
   331| * @param {string} type - 服务类型: 'translate' | 'llm' | 'vlm'
   332| * @param {string} label - 显示名称
   333| * @returns {HTMLElement} 设置行元素
   334| */
   335|function createServiceSelector(type, label) {
   336|    const row = document.createElement("tr");
   337|    row.className = "promptwidget-settings-row";
   338|
   339|    const labelCell = document.createElement("td");
   340|    labelCell.className = "comfy-menu-label";
   341|    row.appendChild(labelCell);
   342|
   343|    const selectCell = document.createElement("td");
   344|
   345|    // 创建加载占位容器
   346|    const container = document.createElement("div");
   347|    container.style.minWidth = "180px";
   348|    container.innerHTML = `<span style="color: var(--p-text-muted-color); font-size: 12px;">${tUI("Loading...")}</span>`;
   349|
   350|    selectCell.appendChild(container);
   351|    row.appendChild(selectCell);
   352|
   353|    let currentOptions = []; // 存储当前选项引用
   354|    let updateDropdownOptions = null; // 存储更新函数
   355|
   356|    /**
   357|     * 更新下拉框内容
   358|     * @param {boolean} force - 是否强制刷新数据
   359|     */
   360|    const updateContent = async (force = false) => {
   361|        try {
   362|            if (force) {
   363|                // 如果是强制刷新（如配置变更或点击触发），先清除缓存
   364|                serviceSelector.clearCache();
   365|            }
   366|
   367|            // 获取服务列表和当前选中的服务
   368|            const [options, currentService] = await Promise.all([
   369|                serviceSelector.getServiceOptions(type),
   370|                serviceSelector.getCurrentService(type)
   371|            ]);
   372|
   373|            // 如果已经存在下拉框实例，则尝试增量更新
   374|            if (updateDropdownOptions) {
   375|                updateDropdownOptions(options, currentService);
   376|                currentOptions = options;
   377|                return;
   378|            }
   379|
   380|            // ---首次加载逻辑---
   381|            container.innerHTML = '';
   382|
   383|            if (options.length === 0) {
   384|                container.innerHTML = `<span style="color: var(--p-text-muted-color); font-size: 12px;">${tUI("No services available")}</span>`;
   385|                return;
   386|            }
   387|
   388|            currentOptions = options;
   389|            const res = createSelectGroup(label, options, currentService, { showLabel: false });
   390|            const { group, select } = res;
   391|            updateDropdownOptions = res.updateOptions;
   392|
   393|            // 将 group 的子元素添加到容器
   394|            while (group.firstChild) {
   395|                container.appendChild(group.firstChild);
   396|            }
   397|
   398|            // 监听点击/按下事件：当用户准备点击下拉框时，尝试静默同步最新配置
   399|            const dropdownContainer = container.querySelector('.pa-dropdown');
   400|            if (dropdownContainer) {
   401|                dropdownContainer.addEventListener('mousedown', () => {
   402|                    // 点击时触发刷新，但不显示“同步中”以避免干扰 UI
   403|                    updateContent(true);
   404|                });
   405|            }
   406|
   407|            // 监听变更事件
   408|            select.addEventListener('change', async () => {
   409|                const newValue = select.value;
   410|                if (!newValue) return;
   411|
   412|                const dropdown = container.querySelector('.pa-dropdown');
   413|                if (dropdown) {
   414|                    dropdown.style.opacity = '0.6';
   415|                    dropdown.style.pointerEvents = 'none';
   416|                }
   417|
   418|                try {
   419|                    const success = await serviceSelector.setCurrentService(type, newValue);
   420|                    if (success) {
   421|                        logger.log(`Set ${label} service | Service: ${newValue}`);
   422|                    } else {
   423|                        logger.error(`Failed to set ${label} service`);
   424|                        const oldValue = await serviceSelector.getCurrentService(type);
   425|                        if (oldValue && updateDropdownOptions) {
   426|                            updateDropdownOptions(currentOptions, oldValue);
   427|                        }
   428|                    }
   429|                } catch (error) {
   430|                    logger.error(`Error setting ${label} service: ${error.message}`);
   431|                } finally {
   432|                    if (dropdown) {
   433|                        dropdown.style.opacity = '';
   434|                        dropdown.style.pointerEvents = '';
   435|                    }
   436|                }
   437|            });
   438|
   439|        } catch (error) {
   440|            logger.error(`Failed to sync ${label} configuration: ${error.message}`);
   441|            if (!updateDropdownOptions) {
   442|                container.innerHTML = `<span style="color: var(--p-red-400); font-size: 12px;">${tUI("Failed to load")}</span>`;
   443|            }
   444|        }
   445|    };
   446|
   447|    // 初始加载
   448|    updateContent();
   449|
   450|    // 监听配置更新事件（当 API Configuration管理器修改配置后触发）
   451|    const onConfigUpdated = () => {
   452|        logger.debug(`Received config update, syncing ${label} status...`);
   453|        updateContent(true);
   454|    };
   455|    window.addEventListener('pa-config-updated', onConfigUpdated);
   456|
   457|    // 销毁监听器的清理函数（简单处理，因为设置面板通常随页面销毁）
   458|    // 如果之后有更复杂的组件挂载逻辑，可以在这里返回一 items清理函数给外部调用
   459|
   460|    return row;
   461|}
   462|
   463|
   464|/**
   465| * 注册设置选项
   466| * 将设置选项添加到ComfyUI设置面板
   467| */
   468|export async function registerSettings() {
   469|    try {
   470|        await ensureUiLocaleLoaded();
   471|        patchToastLocalization();
   472|        syncGlobalUiLocalization();
   473|
   474|        app.registerExtension({
   475|            name: "PromptAssistant.Settings",
   476|            settings: localizeSettingsPayload([
   477|                {
   478|                    id: UI_LANGUAGE_SETTING_ID,
   479|                    name: "Interface Language",
   480|                    category: ["✨ Prompt Assistant", "System", "Interface Language"],
   481|                    type: "combo",
   482|                    options: LANGUAGE_OPTIONS,
   483|                    defaultValue: "en",
   484|                    tooltip: "Switch the plugin UI language; the page refreshes automatically after changes take effect",
   485|                    onChange: (value) => {
   486|                        const previous = getStoredUiLanguage();
   487|                        const normalized = persistUiLanguage(value);
   488|                        if (normalized === previous) return;
   489|                        logger.log(`Interface language changed: ${normalized}`);
   490|                        setTimeout(() => window.location.reload(), 80);
   491|                    }
   492|                },
   493|                // Master Switch - 独立控制小助手System级功能
   494|                {
   495|                    id: "PromptAssistant.Features.Enabled",
   496|                    name: "Enable Assistant",
   497|                    category: ["✨ Prompt Assistant", "Feature Toggles", "Master Switch"],
   498|                    type: "boolean",
   499|                    defaultValue: true,
   500|                    tooltip: "When disabled, all Prompt Assistant features will be turned off",
   501|                    onChange: async (value) => {
   502|                        try {
   503|                            // 获取当前状态，用于判断是否是初始化
   504|                            const currentState = window.FEATURES.enabled;
   505|
   506|                            // 只有状态真正变化时才输出日志
   507|                            if (currentState !== value) {
   508|                                logger.log(`Master switch changed | State:${value ? "Enabled" : "Disabled"}`);
   509|                            } else {
   510|                                // 如果状态没有变化，使用调试级别日志
   511|                                logger.debug(`Master switch unchanged | State:${value ? "Enabled" : "Disabled"}`);
   512|                            }
   513|
   514|                            // 更新全局状态
   515|                            window.FEATURES.enabled = value;
   516|
   517|                            // 从全局 app 对象获取 promptAssistant 实例
   518|                            const promptAssistantInstance = app.promptAssistant;
   519|                            const imageCaptionInstance = app.imageCaption;
   520|
   521|                            if (!promptAssistantInstance) {
   522|                                logger.error("Master switch toggle failed | Error: PromptAssistant instance not found");
   523|                                return;
   524|                            }
   525|
   526|                            // 根据开关状态执行相应操作
   527|                            if (value) {
   528|                                // Enabled功能
   529|                                await promptAssistantInstance.toggleGlobalFeature(true, currentState !== value);
   530|                                if (imageCaptionInstance) {
   531|                                    await imageCaptionInstance.toggleGlobalFeature(true, currentState !== value);
   532|                                }
   533|
   534|                                // 只在状态真正变化且不是首次加载时记录日志和显示提示
   535|                                if (currentState !== value) {
   536|                                    logger.debug("Features enabled");
   537|                                    // 只在状态发生变化且不是首次加载时显示提示
   538|                                    if (!isFirstLoad) {
   539|                                        app.extensionManager.toast.add({
   540|                                            severity: "info",
   541|                                            summary: tUI("Prompt Assistant enabled"),
   542|                                            life: 3000
   543|                                        });
   544|                                    }
   545|                                }
   546|                            } else {
   547|                                // Disabled功能
   548|                                await promptAssistantInstance.toggleGlobalFeature(false, currentState !== value);
   549|                                if (imageCaptionInstance) {
   550|                                    await imageCaptionInstance.toggleGlobalFeature(false, currentState !== value);
   551|                                }
   552|
   553|                                // 只在状态真正变化且不是首次加载时记录日志和显示提示
   554|                                if (currentState !== value) {
   555|                                    logger.debug("Features disabled");
   556|                                    // 只在状态发生变化且不是首次加载时显示提示
   557|                                    if (!isFirstLoad) {
   558|                                        app.extensionManager.toast.add({
   559|                                            severity: "warn",
   560|                                            summary: tUI("Prompt Assistant disabled"),
   561|                                            life: 3000
   562|                                        });
   563|                                    }
   564|                                }
   565|                            }
   566|
   567|                            // 设置首次加载标志为 false，表示已经完成首次加载
   568|                            isFirstLoad = false;
   569|                        } catch (error) {
   570|                            logger.error(`Master switch toggle exception | Error:${error.message}`);
   571|                        }
   572|                    }
   573|                },
   574|
   575|                // 小助手创建方式设置
   576|                {
   577|                    id: "PromptAssistant.Settings.CreationMode",
   578|                    name: "Assistant creation mode (Prompt)",
   579|                    category: ["✨ Prompt Assistant", "System", "Prompt Assistant creation mode"],
   580|                    type: "combo",
   581|                    options: [
   582|                        { text: "Auto-create", value: "auto" },
   583|                        { text: "Create on node selection", value: "manual" }
   584|                    ],
   585|                    defaultValue: "auto",
   586|                    tooltip: "Auto-create: show the assistant when nodes are created or loaded; Create on node selection: show only when a node is selected",
   587|                    onChange: (value) => {
   588|                        logger.log(`Assistant creation mode changed | mode:${value === 'auto' ? 'Auto-create' : 'Create on node selection'}`);
   589|                        // 如果切换到Auto-create，立即尝试初始化所有节点
   590|                        if (value === 'auto' && window.FEATURES.enabled && app.graph) {
   591|                            const nodes = app.graph._nodes || [];
   592|                            nodes.forEach(node => {
   593|                                if (node && !node._promptAssistantInitialized) {
   594|                                    app.promptAssistant.checkAndSetupNode(node);
   595|                                }
   596|                            });
   597|                        }
   598|                    }
   599|                },
   600|
   601|                // 反推小助手创建方式设置
   602|                {
   603|                    id: "PromptAssistant.Settings.ImageCaptionCreationMode",
   604|                    name: "Assistant creation mode (Image caption)",
   605|                    category: ["✨ Prompt Assistant", "System", "Image caption assistant creation mode"],
   606|                    type: "combo",
   607|                    options: [
   608|                        { text: "Auto-create", value: "auto" },
   609|                        { text: "Create on node selection", value: "manual" }
   610|                    ],
   611|                    defaultValue: "auto",
   612|                    tooltip: "Auto-create: show the assistant automatically when nodes are created or loaded; Create on node selection: show only when a node is selected",
   613|                    onChange: (value) => {
   614|                        logger.log(`Image caption assistant creation mode changed | mode:${value === 'auto' ? 'Auto-create' : 'Create on node selection'}`);
   615|                        // 如果切换到Auto-create，立即尝试初始化所有节点
   616|                        if (value === 'auto' && window.FEATURES.enabled && window.FEATURES.imageCaption && app.graph) {
   617|                            const nodes = app.graph._nodes || [];
   618|                            nodes.forEach(node => {
   619|                                if (node && !node._imageCaptionInitialized) {
   620|                                    app.imageCaption.checkAndSetupNode(node);
   621|                                }
   622|                            });
   623|                        }
   624|                    }
   625|                },
   626|
   627|                // Assistant layout (Prompt)
   628|                {
   629|                    id: "PromptAssistant.Location",
   630|                    name: "Assistant layout (Prompt)",
   631|                    category: ["✨ Prompt Assistant", "Interface", "Prompt Assistant layout"],
   632|                    type: "combo",
   633|                    options: [
   634|                        // { text: "Top-left (horizontal)", value: "top-left-h" },
   635|                        // { text: "Top-left (vertical)", value: "top-left-v" },
   636|                        // { text: "Top-center (horizontal)", value: "top-center-h" },
   637|                        // { text: "⇗ ━", value: "top-right-h" },
   638|                        // { text: "⇗ ┃", value: "top-right-v" },
   639|                        { text: "Right-center (vertical)", value: "right-center-v" },
   640|                        { text: "Bottom-right (horizontal)", value: "bottom-right-h" },
   641|                        { text: "Bottom-right (vertical)", value: "bottom-right-v" },
   642|                        { text: "Bottom-center (horizontal)", value: "bottom-center-h" },
   643|                        { text: "Bottom-left (horizontal)", value: "bottom-left-h" },
   644|                        // { text: "Bottom-left (vertical)", value: "bottom-left-v" },
   645|                        // { text: "Left-center (vertical)", value: "left-center-v" }
   646|                    ],
   647|                    defaultValue: "bottom-right-h", // 默认右下Horizontal向
   648|                    tooltip: "Set the layout and expansion direction of the Prompt Assistant around the input box",
   649|                    onChange: (value) => {
   650|                        logger.log(`Prompt Assistant layout changed | layout:${value}`);
   651|                        // 通知所有实例更新layout（通过 CSS 类处理）
   652|                        PromptAssistant.instances.forEach(widget => {
   653|                            if (widget.container && widget.container.setAnchorPosition) {
   654|                                widget.container.setAnchorPosition(value);
   655|                            }
   656|                        });
   657|                    }
   658|                },
   659|                // 小助手位置设置（Image caption）
   660|                {
   661|                    id: "ImageCaption.Location",
   662|                    name: "Assistant layout (Image caption)",
   663|                    category: ["✨ Prompt Assistant", "Interface", "Image caption assistant layout"],
   664|                    type: "combo",
   665|                    options: [
   666|                        { text: "Horizontal", value: "bottom-left-h" },
   667|                        { text: "Vertical", value: "bottom-left-v" }
   668|                    ],
   669|                    defaultValue: "bottom-left-h", // 默认Horizontal向
   670|                    tooltip: "Set the expansion direction of the image caption assistant (fixed in the bottom-left corner)",
   671|                    onChange: (value) => {
   672|                        logger.log(`Image caption assistant layout changed | layout:${value}`);
   673|                        // 通知所有实例更新layout
   674|                        ImageCaption.instances.forEach(assistant => {
   675|                            if (assistant.container && assistant.container.setAnchorPosition) {
   676|                                assistant.container.setAnchorPosition(value);
   677|                            }
   678|                        });
   679|                    },
   680|                },
   681|
   682|                // API Configuration按钮
   683|                {
   684|                    id: "PromptAssistant.Features.APIConfig",
   685|                    name: "Baidu and LLM API configuration",
   686|                    category: ["✨ Prompt Assistant", " Configuration", "API Configuration"],
   687|                    tooltip: "Configure or modify API information",
   688|                    type: () => {
   689|                        const row = document.createElement("tr");
   690|                        row.className = "promptwidget-settings-row";
   691|
   692|                        const labelCell = document.createElement("td");
   693|                        labelCell.className = "comfy-menu-label";
   694|                        row.appendChild(labelCell);
   695|
   696|                        const buttonCell = document.createElement("td");
   697|                        const button = createLoadingButton(tUI("API Manager"), async () => {
   698|                            showAPIConfigModal();
   699|                        }, false); // 设置 showSuccessToast 为 false
   700|
   701|                        buttonCell.appendChild(button);
   702|                        row.appendChild(buttonCell);
   703|                        return row;
   704|                    }
   705|                },
   706|
   707|                // ---服务类别设置---
   708|                // Translation服务选择
   709|                {
   710|                    id: "PromptAssistant.Service.Translate",
   711|                    name: "Select translation service",
   712|                    category: ["✨ Prompt Assistant", " Configuration", "Translation"],
   713|                    tooltip: "Select a provider for translation; you can also switch it via the right-click translation button",
   714|                    type: () => {
   715|                        return createServiceSelector('translate', 'Translation');
   716|                    }
   717|                },
   718|
   719|                // Prompt optimization服务选择
   720|                {
   721|                    id: "PromptAssistant.Service.LLM",
   722|                    name: "Select prompt optimization service",
   723|                    category: ["✨ Prompt Assistant", " Configuration", "Prompt optimization"],
   724|                    tooltip: "Select a provider for prompt optimization; you can also switch it via the right-click prompt optimization button",
   725|                    type: () => {
   726|                        return createServiceSelector('llm', 'Prompt optimization');
   727|                    }
   728|                },
   729|
   730|                // Image caption服务选择
   731|                {
   732|                    id: "PromptAssistant.Service.VLM",
   733|                    name: "Select image caption service",
   734|                    category: ["✨ Prompt Assistant", " Configuration", "Image caption"],
   735|                    tooltip: "Select a provider for image captioning; you can also switch it via the right-click caption button",
   736|                    type: () => {
   737|                        return createServiceSelector('vlm', 'Image caption');
   738|                    }
   739|                },
   740|
   741|                // History（包含历史、撤销、重做按钮）
   742|                {
   743|                    id: "PromptAssistant.Features.History",
   744|                    name: "Enable history",
   745|                    category: ["✨ Prompt Assistant", "Feature Toggles", "History"],
   746|                    type: "boolean",
   747|                    defaultValue: true,
   748|                    tooltip: "Enable or disable history, undo, and redo",
   749|                    onChange: (value) => {
   750|                        const oldValue = FEATURES.history;
   751|                        FEATURES.history = value;
   752|                        handleFeatureChange('History', value, oldValue);
   753|                        logger.log(`History - ${value ? "Enabled" : "Disabled"}`);
   754|                    }
   755|                },
   756|
   757|                // 标签工具
   758|                {
   759|                    id: "PromptAssistant.Features.Tag",
   760|                    name: "Enable tag tool",
   761|                    category: ["✨ Prompt Assistant", "Feature Toggles", "Tag tool"],
   762|                    type: "boolean",
   763|                    defaultValue: true,
   764|                    tooltip: "Enable or disable tag tool",
   765|                    onChange: (value) => {
   766|                        const oldValue = FEATURES.tag;
   767|                        FEATURES.tag = value;
   768|                        handleFeatureChange('标签工具', value, oldValue);
   769|                        logger.log(`Tag tool - ${value ? "Enabled" : "Disabled"}`);
   770|                    }
   771|                },
   772|
   773|                // 扩写功能
   774|                {
   775|                    id: "PromptAssistant.Features.Expand",
   776|                    name: "Enable prompt optimization",
   777|                    category: ["✨ Prompt Assistant", "Feature Toggles", "Prompt optimization feature"],
   778|                    type: "boolean",
   779|                    defaultValue: true,
   780|                    tooltip: "Enable or disable prompt optimization",
   781|                    onChange: (value) => {
   782|                        const oldValue = FEATURES.expand;
   783|                        FEATURES.expand = value;
   784|                        handleFeatureChange('Prompt optimization feature', value, oldValue);
   785|                        logger.log(`Prompt optimization feature - ${value ? "Enabled" : "Disabled"}`);
   786|                    }
   787|                },
   788|
   789|                // Translation feature
   790|                {
   791|                    id: "PromptAssistant.Features.Translate",
   792|                    name: "Enable translation",
   793|                    category: ["✨ Prompt Assistant", "Feature Toggles", "Translation feature"],
   794|                    type: "boolean",
   795|                    defaultValue: true,
   796|                    tooltip: "Enable or disable translation",
   797|                    onChange: (value) => {
   798|                        const oldValue = FEATURES.translate;
   799|                        FEATURES.translate = value;
   800|                        handleFeatureChange('Translation feature', value, oldValue);
   801|                        logger.log(`Translation feature - ${value ? "Enabled" : "Disabled"}`);
   802|                    }
   803|                },
   804|
   805|                // Use translation cache功能
   806|                {
   807|                    id: "PromptAssistant.Features.UseTranslateCache",
   808|                    name: "Use translation cache",
   809|                    category: ["✨ Prompt Assistant", " Translation feature settings", "Translation cache"],
   810|                    type: "boolean",
   811|                    defaultValue: true,
   812|                    tooltip: "When enabled, previously translated content will reuse cached results to avoid re-translating the same text. If you need a fresh translation, just add a space to bypass the cache.",
   813|                    onChange: (value) => {
   814|                        const oldValue = FEATURES.useTranslateCache;
   815|                        FEATURES.useTranslateCache = value;
   816|                        logger.log(`Translation cache - ${value ? "Enabled" : "Disabled"}`);
   817|                    }
   818|                },
   819|
   820|                // Mixed-language cache选项
   821|                {
   822|                    id: "PromptAssistant.Features.CacheMixedLangTranslation",
   823|                    name: "Cache mixed-language translations",
   824|                    category: ["✨ Prompt Assistant", " Translation feature settings", "Mixed-language cache"],
   825|                    type: "boolean",
   826|                    defaultValue: false,
   827|                    tooltip: "When disabled, mixed Chinese/English translation results will not be cached to avoid polluting the cache. When enabled, they will be cached normally.",
   828|                    onChange: (value) => {
   829|                        FEATURES.cacheMixedLangTranslation = value;
   830|                        logger.log(`Mixed-language cache - ${value ? "Enabled" : "Disabled"}`);
   831|                    }
   832|                },
   833|
   834|                // 混合语言TranslationRules
   835|                {
   836|                    id: "PromptAssistant.Features.MixedLangTranslateRule",
   837|                    name: "Mixed Language Translation Rule",
   838|                    category: ["✨ Prompt Assistant", "Translation Settings", "Mixed Language Rule"],
   839|                    type: "combo",
   840|                    options: [
   841|                        { text: "Translate to English", value: "to_en" },
   842|                        { text: "Translate to Chinese", value: "to_zh" },
   843|                        { text: "Auto-translate minority-language text", value: "auto_minor" },
   844|                        { text: "Auto-translate majority-language text", value: "auto_major" }
   845|                    ],
   846|                    defaultValue: "to_en",
   847|                    tooltip: "Set the translation rule for mixed Chinese/English content based on your preference",
   848|                    onChange: (value) => {
   849|                        FEATURES.mixedLangTranslateRule = value;
   850|                        logger.log(`Mixed-language translation rule set to:${value}`);
   851|                    }
   852|                },
   853|
   854|                // Translation格式化选项
   855|                {
   856|                    id: "PromptAssistant.Features.TranslateFormatPunctuation",
   857|                    name: "Always use half-width punctuation",
   858|                    category: ["✨ Prompt Assistant", " Translation feature settings", "Punctuation handling"],
   859|                    type: "boolean",
   860|                    defaultValue: false,
   861|                    tooltip: "When enabled, translation results automatically replace Chinese punctuation with English punctuation",
   862|                    onChange: (value) => {
   863|                        FEATURES.translateFormatPunctuation = value;
   864|                        logger.log(`Punctuation conversion - ${value ? "Enabled" : "Disabled"}`);
   865|                    }
   866|                },
   867|                {
   868|                    id: "PromptAssistant.Features.TranslateFormatSpace",
   869|                    name: "Remove extra spaces automatically",
   870|                    category: ["✨ Prompt Assistant", " Translation feature settings", "Space handling"],
   871|                    type: "boolean",
   872|                    defaultValue: false,
   873|                    tooltip: "When enabled, translation results automatically remove extra spaces",
   874|                    onChange: (value) => {
   875|                        FEATURES.translateFormatSpace = value;
   876|                        logger.log(`Remove extra spaces - ${value ? "Enabled" : "Disabled"}`);
   877|                    }
   878|                },
   879|                {
   880|                    id: "PromptAssistant.Features.TranslateFormatDots",
   881|                    name: "Remove extra ellipses",
   882|                    category: ["✨ Prompt Assistant", " Translation feature settings", "Ellipsis handling"],
   883|                    type: "boolean",
   884|                    defaultValue: false,
   885|                    tooltip: "When enabled, extra “......” sequences in translation results will be normalized to “...”",
   886|                    onChange: (value) => {
   887|                        FEATURES.translateFormatDots = value;
   888|                        logger.log(`Ellipsis handling - ${value ? "Enabled" : "Disabled"}`);
   889|                    }
   890|                },
   891|                {
   892|                    id: "PromptAssistant.Features.TranslateFormatNewline",
   893|                    name: "Preserve line breaks",
   894|                    category: ["✨ Prompt Assistant", " Translation feature settings", "Line break handling"],
   895|                    type: "boolean",
   896|                    defaultValue: true,
   897|                    tooltip: "When enabled, translation results will preserve line breaks as much as possible to avoid losing paragraphs",
   898|                    onChange: (value) => {
   899|                        FEATURES.translateFormatNewline = value;
   900|                        logger.log(`Preserve line breaks - ${value ? "Enabled" : "Disabled"}`);
   901|                    }
   902|                },
   903|
   904|
   905|
   906|                // Image caption功能
   907|                {
   908|                    id: "PromptAssistant.Features.ImageCaption",
   909|                    name: "Enable image captioning",
   910|                    category: ["✨ Prompt Assistant", "Feature Toggles", "Image caption"],
   911|                    type: "boolean",
   912|                    defaultValue: true,
   913|                    tooltip: "Enable or disable image captioning prompts",
   914|                    onChange: (value) => {
   915|                        const oldValue = FEATURES.imageCaption;
   916|                        FEATURES.imageCaption = value;
   917|                        handleFeatureChange('Image caption', value, oldValue);
   918|                        logger.log(`Image captioning - ${value ? "Enabled" : "Disabled"}`);
   919|                    }
   920|                },
   921|
   922|                // 节点帮助Translation feature
   923|                {
   924|                    id: "PromptAssistant.Features.NodeHelpTranslator",
   925|                    name: "Enable node info translation",
   926|                    category: ["✨ Prompt Assistant", "Feature Toggles", "Node info translation"],
   927|                    type: "boolean",
   928|                    defaultValue: true,
   929|                    tooltip: "Enable or disable translation of ComfyUI sidebar node help documentation",
   930|                    onChange: (value) => {
   931|                        const oldValue = FEATURES.nodeHelpTranslator;
   932|                        FEATURES.nodeHelpTranslator = value;
   933|                        handleFeatureChange('Node info translation', value, oldValue);
   934|                        logger.log(`Node info translation - ${value ? "Enabled" : "Disabled"}`);
   935|                    }
   936|                },
   937|                // System设置
   938|                {
   939|                    id: "PromptAssistant.Settings.LogLevel",
   940|                    name: "Log level",
   941|                    category: ["✨ Prompt Assistant", "System", "Log level"],
   942|                    type: "hidden",
   943|                    defaultValue: "0",
   944|                    options: [
   945|                        { text: "Error logs", value: "0" },
   946|                        { text: "Basic logs", value: "1" },
   947|                        { text: "Debug logs", value: "2" }
   948|                    ],
   949|                    tooltip: "Set the log output level: Error logs (errors only), Basic logs (errors + basic info), Debug logs (errors + basic info + debug info)",
   950|                    onChange: (value) => {
   951|                        const oldValue = window.FEATURES.logLevel;
   952|                        window.FEATURES.logLevel = parseInt(value);
   953|                        logger.setLevel(window.FEATURES.logLevel);
   954|                        logger.log(`Log level updated | Previous:${oldValue} | New:${value}`);
   955|                    }
   956|                },
   957|
   958|                // 显示流式输出进度
   959|                {
   960|                    id: "PromptAssistant.Settings.ShowStreamingProgress",
   961|                    name: "Console streaming progress logs",
   962|                    category: ["✨ Prompt Assistant", "System", "Terminal logs"],
   963|                    type: "boolean",
   964|                    defaultValue: false,
   965|                    tooltip: "When enabled, the console shows streaming progress output; on some terminals this may spam the screen. When disabled, only the static “Generating...” is shown.",
   966|                    onChange: async (value) => {
   967|                        FEATURES.showStreamingProgress = value;
   968|                        // 通知后端更新设置
   969|                        try {
   970|                            await fetch(APIService.getApiUrl('/settings/streaming_progress'), {
   971|                                method: 'POST',
   972|                                headers: { 'Content-Type': 'application/json' },
   973|                                body: JSON.stringify({ enabled: value })
   974|                            });
   975|                        } catch (error) {
   976|                            logger.error(`Failed to update streaming progress setting: ${error.message}`);
   977|                        }
   978|                        logger.log(`Streaming progress - ${value ? "Enabled" : "Disabled"}`);
   979|                    }
   980|                },
   981|
   982|                // Streaming output toggle
   983|                {
   984|                    id: "PromptAssistant.Settings.EnableStreaming",
   985|                    name: "Streaming output toggle",
   986|                    category: ["✨ Prompt Assistant", "System", "Streaming experience"],
   987|                    type: "boolean",
   988|                    defaultValue: true,
   989|                    tooltip: "When enabled, translation, expansion, recognition, and similar features render as streaming text; when disabled, they use a blocking full-response display.",
   990|                    onChange: (value) => {
   991|                        FEATURES.enableStreaming = value;
   992|                        logger.log(`Streaming output toggle - ${value ? "Enabled" : "Disabled"}`);
   993|                    }
   994|                },
   995|
   996|                {
   997|                    id: "PromptAssistant.Settings.IconOpacity",
   998|                    name: "Assistant icon opacity",
   999|                    category: ["✨ Prompt Assistant", "Interface", "Assistant icon"],
  1000|                    type: "slider",
  1001|                    min: 0,
  1002|                    max: 100,
  1003|                    step: 1,
  1004|                    defaultValue: 20,
  1005|                    tooltip: "Set the opacity of the collapsed assistant icon",
  1006|                    onChange: (value) => {
  1007|                        // 将0-100的值转换为0-1的透明度
  1008|                        const opacity = value * 0.01;
  1009|                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
  1010|                        logger.log(`Assistant icon opacity updated | Value:${value}% | Opacity:${opacity}`);
  1011|                    },
  1012|                    onLoad: (value) => {
  1013|                        // 初始化时应用默认值
  1014|                        const opacity = value * 0.01;
  1015|                        document.documentElement.style.setProperty('--assistant-icon-opacity', opacity);
  1016|                        logger.debug(`Assistant icon opacity initialized | Value:${value}% | Opacity:${opacity}`);
  1017|                    }
  1018|                },
  1019|
  1020|                {
  1021|                    id: "PromptAssistant.Settings.ClearCache",
  1022|                    name: "Clear history, tag, and translation caches",
  1023|                    category: ["✨ Prompt Assistant", "System", "Clear cache"],
  1024|                    tooltip: "Clear all caches, including history records, tags, translation cache, and node documentation translation cache",
  1025|                    type: () => {
  1026|                        const row = document.createElement("tr");
  1027|                        row.className = "promptwidget-settings-row";
  1028|
  1029|                        const labelCell = document.createElement("td");
  1030|                        labelCell.className = "comfy-menu-label";
  1031|                        row.appendChild(labelCell);
  1032|
  1033|                        const buttonCell = document.createElement("td");
  1034|                        const button = createLoadingButton(tUI("Clear all caches"), async () => {
  1035|                            try {
  1036|                                // 获取清理前的缓存统计
  1037|                                const beforeStats = {
  1038|                                    history: HistoryCacheService.getHistoryStats(),
  1039|                                    tags: 0,
  1040|                                    translate: TranslateCacheService.getTranslateCacheStats(),
  1041|                                    nodeHelpTranslate: 0 // 节点文档Translation cache
  1042|                                };
  1043|
  1044|                                // 统计所有标签数量
  1045|                                const tagCacheKeys = Object.keys(localStorage)
  1046|                                    .filter(key => key.startsWith(CACHE_CONFIG.TAG_KEY_PREFIX));
  1047|
  1048|                                // 计算所有缓存中的标签总数
  1049|                                tagCacheKeys.forEach(key => {
  1050|                                    try {
  1051|                                        const cacheData = JSON.parse(localStorage.getItem(key));
  1052|                                        if (cacheData && typeof cacheData === 'object') {
  1053|                                            // 获取缓存中的标签数量
  1054|                                            const tagCount = Object.keys(cacheData).length;
  1055|                                            beforeStats.tags += tagCount;
  1056|                                        }
  1057|                                    } catch (e) {
  1058|                                        // 移除Error logs，静默处理解析错误
  1059|                                    }
  1060|                                });
  1061|
  1062|                                // 统计节点文档Translation cache数量
  1063|                                try {
  1064|                                    const nodeHelpCache = sessionStorage.getItem('pa_node_help_translations');
  1065|                                    if (nodeHelpCache) {
  1066|                                        const parsed = JSON.parse(nodeHelpCache);
  1067|                                        beforeStats.nodeHelpTranslate = Object.keys(parsed).length;
  1068|                                    }
  1069|                                } catch (e) {
  1070|                                    // 静默处理
  1071|                                }
  1072|
  1073|                                // 执行历史记录清理操作
  1074|                                HistoryCacheService.clearAllHistory();
  1075|
  1076|                                // 清理所有标签缓存
  1077|                                TagCacheService.clearAllTagCache();
  1078|
  1079|                                // 清理Translation cache
  1080|                                TranslateCacheService.clearAllTranslateCache();
  1081|
  1082|                                // 清理节点文档Translation cache（sessionStorage）
  1083|                                sessionStorage.removeItem('pa_node_help_translations');
  1084|
  1085|                                // 清理旧版本的标签缓存（以PromptAssistant_tag_cache_开头的所有记录）
  1086|                                Object.keys(localStorage)
  1087|                                    .filter(key => key.startsWith('PromptAssistant_tag_cache_'))
  1088|                                    .forEach(key => localStorage.removeItem(key));
  1089|
  1090|                                // 清除1.0.3以前版本遗留的三项配置信息，避免泄露
  1091|                                localStorage.removeItem("PromptAssistant_Settings_llm_api_key");
  1092|                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_secret");
  1093|                                localStorage.removeItem("PromptAssistant_Settings_baidu_translate_appid");
  1094|
  1095|                                // 获取清理后的缓存统计
  1096|                                const afterStats = {
  1097|                                    history: HistoryCacheService.getHistoryStats(),
  1098|                                    tags: 0, // 清理后标签数应该为0
  1099|                                    translate: TranslateCacheService.getTranslateCacheStats()
  1100|                                };
  1101|
  1102|                                // 计算清理数量
  1103|                                const clearedHistory = beforeStats.history.total - afterStats.history.total;
  1104|                                const clearedTags = beforeStats.tags;
  1105|                                const clearedTranslate = beforeStats.translate.total - afterStats.translate.total;
  1106|                                const clearedNodeHelp = beforeStats.nodeHelpTranslate;
  1107|
  1108|                                // 只输出最终统计结果
  1109|                                logger.log(`Cache cleared | History records: ${clearedHistory} entries | Tags: ${clearedTags} items | Translation: ${clearedTranslate} entries | Node docs: ${clearedNodeHelp} items`);
  1110|
  1111|                                // 更新所有实例的撤销/重做按钮状态
  1112|                                PromptAssistant.instances.forEach((instance) => {
  1113|                                    if (instance && instance.nodeId && instance.inputId) {
  1114|                                        UIToolkit.updateUndoRedoButtonState(instance, HistoryCacheService);
  1115|                                    }
  1116|                                });
  1117|
  1118|                            } catch (error) {
  1119|                                // 简化Error logs
  1120|                                logger.error(`Cache clear failed`);
  1121|                                throw error;
  1122|                            }
  1123|                        });
  1124|
  1125|                        buttonCell.appendChild(button);
  1126|                        row.appendChild(buttonCell);
  1127|                        return row;
  1128|                    }
  1129|                },
  1130|
  1131|
  1132|
  1133|                // About插件信息
  1134|                {
  1135|                    id: "PromptAssistant.Settings.About",
  1136|                    name: "About",
  1137|                    category: ["✨ Prompt Assistant", " ✨ Prompt Assistant"],
  1138|                    type: () => {
  1139|                        const row = document.createElement("tr");
  1140|                        row.className = "promptwidget-settings-row";
  1141|                        const cell = document.createElement("td");
  1142|                        cell.colSpan = 2;
  1143|                        cell.style.display = "flex";
  1144|                        cell.style.alignItems = "center";
  1145|                        cell.style.gap = "12px";
  1146|                        // 版本徽标容器（整体可点击跳转最新版本）
  1147|                        const versionLink = document.createElement("a");
  1148|                        versionLink.href = "https://github.com/yawiii/ComfyUI-Prompt-Assistant/releases/latest";
  1149|                        versionLink.target = "_blank";
  1150|                        versionLink.style.textDecoration = "none";
  1151|                        versionLink.style.display = "flex";
  1152|                        versionLink.style.alignItems = "center";
  1153|                        versionLink.style.cursor = "pointer";
  1154|
  1155|                        const versionContainer = document.createElement("div");
  1156|                        versionContainer.style.display = "flex";
  1157|                        versionContainer.style.alignItems = "center";
  1158|                        versionContainer.style.gap = "8px";
  1159|                        versionLink.appendChild(versionContainer);
  1160|
  1161|                        // 版本徽标
  1162|                        const versionBadge = document.createElement("img");
  1163|                        versionBadge.alt = "Version";
  1164|                        versionBadge.style.display = "block";
  1165|                        versionBadge.style.height = "20px";
  1166|
  1167|                        // 从全局变量获取版本号
  1168|                        if (!window.PromptAssistant_Version) {
  1169|                            logger.error(tUI("Version number not found; the badge may not display correctly"));
  1170|                            versionBadge.src = `https://img.shields.io/badge/%E7%89%88%E6%9C%AC-%E6%9C%AA%E7%9F%A5-red?style=flat`;
  1171|                            versionContainer.appendChild(versionBadge);
  1172|                        } else {
  1173|                            const currentVersion = window.PromptAssistant_Version;
  1174|                            versionBadge.src = `https://img.shields.io/badge/%E7%89%88%E6%9C%AC-${currentVersion}-green?style=flat`;
  1175|                            versionContainer.appendChild(versionBadge);
  1176|
  1177|                            // 使用缓存检查版本，避免重复请求
  1178|                            if (versionCheckCache.checked && versionCheckCache.hasUpdate) {
  1179|                                // 已检查过且有更新，直接应用缓存的结果
  1180|                                const latestVersion = versionCheckCache.latestVersion;
  1181|                                const labelEncoded = encodeURIComponent(tUI("New version available"));
  1182|                                const messageEncoded = encodeURIComponent(`${currentVersion}→${latestVersion}`);
  1183|                                versionBadge.src = `https://img.shields.io/badge/${labelEncoded}-${messageEncoded}-orange?style=flat&labelColor=555555`;
  1184|                                versionBadge.style.cursor = "pointer";
  1185|                                versionBadge.title = `${tUI("Current version:")} ${currentVersion}\n${tUI("Latest version:")} ${latestVersion}\n${tUI("Click to download")}`;
  1186|                            } else if (!versionCheckCache.checked) {
  1187|                                // 首次检查，发起异步请求
  1188|                                fetchLatestVersion().then(latestVersion => {
  1189|                                    if (latestVersion && compareVersion(latestVersion, currentVersion) > 0) {
  1190|                                        versionCheckCache.hasUpdate = true;
  1191|                                        const labelEncoded = encodeURIComponent(tUI("New version available"));
  1192|                                        const messageEncoded = encodeURIComponent(`${currentVersion}→${latestVersion}`);
  1193|                                        versionBadge.src = `https://img.shields.io/badge/${labelEncoded}-${messageEncoded}-orange?style=flat&labelColor=555555`;
  1194|                                        versionBadge.style.cursor = "pointer";
  1195|                                        versionBadge.title = `${tUI("Current version:")} ${currentVersion}\n${tUI("Latest version:")} ${latestVersion}\n${tUI("Click to download")}`;
  1196|                                        logger.log(`[版本检查] 发现新版本: ${currentVersion} → ${latestVersion}`);
  1197|                                    } else if (latestVersion) {
  1198|                                        versionBadge.title = `${tUI("Already on the latest version:")} ${currentVersion}`;
  1199|                                        logger.debug(`[版本检查] Current version: ${currentVersion}`);
  1200|                                    }
  1201|                                }).catch(error => {
  1202|                                    logger.warn(`[版本检查] 出错: ${error.message}`);
  1203|                                });
  1204|                            } else {
  1205|                                // 已检查过但没有更新
  1206|                                versionBadge.title = `${tUI("Already on the latest version:")} ${currentVersion}`;
  1207|                            }
  1208|                        }
  1209|
  1210|                        cell.appendChild(versionLink);
  1211|
  1212|                        // GitHub 徽标
  1213|                        const authorTag = document.createElement("a");
  1214|                        authorTag.href = "https://github.com/yawiii/ComfyUI-Prompt-Assistant";
  1215|                        authorTag.target = "_blank";
  1216|                        authorTag.style.textDecoration = "none";
  1217|                        authorTag.style.display = "flex";
  1218|                        authorTag.style.alignItems = "center";
  1219|                        const authorBadge = document.createElement("img");
  1220|                        authorBadge.alt = "Static Badge";
  1221|                        authorBadge.src = "https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant?style=flat&logo=github&logoColor=%23292F34&label=Yawiii&labelColor=%23FFFFFF&color=blue";
  1222|                        authorBadge.style.display = "block";
  1223|                        authorBadge.style.height = "20px";
  1224|                        authorTag.appendChild(authorBadge);
  1225|                        cell.appendChild(authorTag);
  1226|
  1227|                        // B站徽标
  1228|                        const biliTag = document.createElement("a");
  1229|                        biliTag.href = "https://space.bilibili.com/520680644";
  1230|                        biliTag.target = "_blank";
  1231|                        biliTag.style.textDecoration = "none";
  1232|                        biliTag.style.display = "flex";
  1233|                        biliTag.style.alignItems = "center";
  1234|                        const biliBadge = document.createElement("img");
  1235|                        biliBadge.alt = "Bilibili";
  1236|                        biliBadge.src = "https://img.shields.io/badge/%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7";
  1237|                        biliBadge.style.display = "block";
  1238|                        biliBadge.style.height = "20px";
  1239|                        biliTag.appendChild(biliBadge);
  1240|                        cell.appendChild(biliTag);
  1241|                        // 交流群徽标
  1242|                        const wechatTag = document.createElement("a");
  1243|                        // 取消跳转；点击不再打开链接，避免本地缓存链接
  1244|                        wechatTag.href = 'javascript:void(0)';
  1245|                        wechatTag.addEventListener('click', (e) => { e.preventDefault(); toggleWechatQr(); });
  1246|                        wechatTag.style.textDecoration = "none";
  1247|                        wechatTag.style.display = "flex";
  1248|                        wechatTag.style.alignItems = "center";
  1249|                        wechatTag.classList.add("has-tooltip", "pa-wechat-badge");
  1250|                        const wechatBadge = document.createElement("img");
  1251|                        wechatBadge.alt = tUI("Feedback group");
  1252|                        wechatBadge.src = "https://img.shields.io/badge/%E4%BA%A4%E6%B5%81%E5%8F%8D%E9%A6%88-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7";
  1253|                        wechatBadge.style.display = "block";
  1254|                        wechatBadge.style.height = "20px";
  1255|                        wechatTag.appendChild(wechatBadge);
  1256|
  1257|                        // 悬浮显示二维码
  1258|                        const wechatQr = document.createElement("div");
  1259|                        wechatQr.className = "pa-wechat-qr";
  1260|                        const wechatQrImg = document.createElement("img");
  1261|                        // 优先加载远程二维码，失败则回退到本地备用图
  1262|                        const remoteQrUrl = 'http://data.xflow.cc/wechat.png';
  1263|                        let qrFallbackTimer = null;
  1264|                        const localQrUrl = ResourceManager.getAssetUrl('wechat.png');
  1265|
  1266|                        // 每次显示时强制重新加载远程二维码（带时间戳），避免缓存
  1267|                        const loadWechatQr = () => {
  1268|                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
  1269|                            wechatQrImg.dataset.fallbackApplied = '';
  1270|                            wechatQrImg.dataset.source = 'remote';
  1271|                            wechatQrImg.src = `${remoteQrUrl}?t=${Date.now()}`;
  1272|                            // 超时回退到本地，但需要判断图片是否已开始加载
  1273|                            qrFallbackTimer = setTimeout(() => {
  1274|                                // 检查是否已标记为已回退
  1275|                                if (wechatQrImg.dataset.fallbackApplied === '1') return;
  1276|
  1277|                                // 检查图片是否已开始加载（naturalHeight > 0 说明图片正在加载）
  1278|                                if (wechatQrImg.naturalHeight > 0) {
  1279|                                    Logger.log(2, '远程二维码加载中，延长等待时间');
  1280|                                    // 图片已开始加载，继续等待 onload，取消超时回退
  1281|                                    if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
  1282|                                } else {
  1283|                                    // 图片未开始加载，可能是网络问题，回退到本地
  1284|                                    Logger.log(1, '远程二维码加载超时，切换到本地备用图');
  1285|                                    loadLocalQr();
  1286|                                }
  1287|                            }, 3000); // 延长到 3 秒，给远程图片更多加载时间
  1288|                        };
  1289|                        // 手动切换到本地二维码（带时间戳），清理超时
  1290|                        const loadLocalQr = () => {
  1291|                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
  1292|                            wechatQrImg.dataset.fallbackApplied = '1';
  1293|                            wechatQrImg.dataset.source = 'local';
  1294|                            wechatQrImg.src = localQrUrl; // 本地图片固定，不加时间戳
  1295|                        };
  1296|
  1297|                        // 点击徽标时在远程/本地之间来回切换
  1298|                        const toggleWechatQr = () => {
  1299|                            if (wechatQrImg.dataset.source === 'local') {
  1300|                                loadWechatQr();
  1301|                            } else {
  1302|                                loadLocalQr();
  1303|                            }
  1304|                        };
  1305|
  1306|
  1307|                        wechatQrImg.alt = tUI("WeChat group QR code");
  1308|                        wechatQrImg.className = "pa-wechat-qr-img";
  1309|
  1310|                        // 加载成功清理超时定时器
  1311|                        wechatQrImg.onload = () => { if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; } };
  1312|
  1313|                        // 远程Failed to load时回退到本地备用图（也带时间戳避免缓存）
  1314|                        wechatQrImg.onerror = () => {
  1315|                            if (qrFallbackTimer) { clearTimeout(qrFallbackTimer); qrFallbackTimer = null; }
  1316|                            if (wechatQrImg.dataset.fallbackApplied !== '1') {
  1317|                                loadLocalQr();
  1318|                            }
  1319|                        };
  1320|
  1321|                        // 初次渲染和每次鼠标进入都触发重新加载
  1322|                        loadWechatQr();
  1323|                        wechatTag.addEventListener('mouseenter', loadWechatQr);
  1324|
  1325|                        wechatQr.appendChild(wechatQrImg);
  1326|                        wechatTag.appendChild(wechatQr);
  1327|
  1328|                        cell.appendChild(wechatTag);
  1329|
  1330|                        row.appendChild(cell);
  1331|                        return row;
  1332|                    }
  1333|                },
  1334|
  1335|                // Rules配置按钮
  1336|                {
  1337|                    id: "PromptAssistant.Features.RulesConfig",
  1338|                    name: "Prompt optimization and captioning rule editor",
  1339|                    category: ["✨ Prompt Assistant", " Configuration", "Rules"],
  1340|                    tooltip: "You can customize prompt optimization rules and captioning prompt rules to make generated prompts better fit your needs",
  1341|                    type: () => {
  1342|                        const row = document.createElement("tr");
  1343|                        row.className = "promptwidget-settings-row";
  1344|
  1345|                        const labelCell = document.createElement("td");
  1346|                        labelCell.className = "comfy-menu-label";
  1347|                        row.appendChild(labelCell);
  1348|
  1349|                        const buttonCell = document.createElement("td");
  1350|                        const button = createLoadingButton(tUI("Rules Manager"), async () => {
  1351|                            showRulesConfigModal();
  1352|                        }, false);
  1353|
  1354|                        buttonCell.appendChild(button);
  1355|                        row.appendChild(buttonCell);
  1356|                        return row;
  1357|                    }
  1358|                },
  1359|
  1360|            ])
  1361|        });
  1362|
  1363|        logger.log("Assistant settings registered successfully");
  1364|        return true;
  1365|    } catch (error) {
  1366|        logger.error(`Failed to register assistant settings: ${error.message}`);
  1367|        return false;
  1368|    }
  1369|}
  1370|