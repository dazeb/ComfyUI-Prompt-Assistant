     1|/**
     2| * API配置管理器 v2.0
     3| * 支持动态Provider管理和多模型配置
     4| */
     5|
     6|import { app } from "../../../../scripts/app.js";
     7|import { logger } from '../utils/logger.js';
     8|import {
     9|    createSettingsDialog,
    10|    createFormGroup,
    11|    createInputGroup,
    12|    createSelectGroup,
    13|    createHorizontalFormGroup,
    14|    createSwitchControl,
    15|    createConfirmPopup,
    16|    createContextMenu,
    17|    createTooltip,
    18|    createMultiSelectListbox
    19|} from "./uiComponents.js";
    20|import { APIService } from "../services/api.js";
    21|import { tUI } from "../utils/uiI18n.js";
    22|
    23|// Sortable库已通过script标签加载，直接使用全局变量
    24|
    25|class APIConfigManager {
    26|    // 预置ProviderID列表（不可编辑/Delete）
    27|    static PRESET_SERVICE_IDS = ['zhipu', 'xFlow', 'opencode_zen', 'opencode_go', 'ollama'];
    28|
    29|    constructor() {
    30|        // Provider数据
    31|        this.services = [];
    32|        this.currentServices = { llm: null, vlm: null };
    33|
    34|        // Baidu translation settings
    35|        this.baiduConfig = { app_id: '', secret_key: '' };
    36|    }
    37|
    38|    /**
    39|     * 通知系统 API 配置已更新
    40|     * 触发 pa-config-updated 事件，通知 settings.js 等模块刷新
    41|     */
    42|    notifyConfigChange() {
    43|        logger.debug('分发 API 配置更新事件: pa-config-updated');
    44|        window.dispatchEvent(new CustomEvent('pa-config-updated'));
    45|    }
    46|
    47|    /**
    48|     * 显示API配置弹窗
    49|     */
    50|    async showAPIConfigModal() {
    51|        try {
    52|            logger.debug('打开API配置弹窗 v2.0');
    53|
    54|            createSettingsDialog({
    55|                title: `<i class="pi pi-cog" style="margin-right: 8px;"></i>${tUI('API Manager')}`,
    56|                dialogClassName: 'api-config-dialog-v2',
    57|                disableBackdropAndCloseOnClickOutside: true,
    58|                hideFooter: true,  // 不显示底部的Save/Cancel按钮
    59|                renderNotice: (noticeArea) => {
    60|                    const subtitle = document.createElement('div');
    61|                    subtitle.className = 'api-config-warning';
    62|                    subtitle.textContent = `*${tUI('Disclaimer: This plugin only provides API calling tools. It is not affiliated with any third-party service provider, and user configuration data is stored locally. The plugin assumes no responsibility for any issues arising from account use!')}`;
    63|                    noticeArea.appendChild(subtitle);
    64|                },
    65|                renderContent: async (container) => {
    66|                    await this._loadAllConfigs();
    67|                    this._createAPIConfigUI(container);
    68|                },
    69|                onSave: async () => {
    70|                    // 不再需要手动Save，因为已经实时Save了
    71|                }
    72|            });
    73|        } catch (error) {
    74|            logger.error(`打开API配置弹窗失败: ${error.message}`);
    75|            app.extensionManager.toast.add({
    76|                severity: "error",
    77|                summary: "Failed to open configuration",
    78|                detail: error.message,
    79|                life: 3000
    80|            });
    81|        }
    82|    }
    83|
    84|    /**
    85|     * 加载所有配置
    86|     */
    87|    async _loadAllConfigs() {
    88|        try {
    89|            // 加载Provider列表
    90|            const servicesRes = await fetch(APIService.getApiUrl('/services'));
    91|            const servicesData = await servicesRes.json();
    92|
    93|            if (servicesData.success) {
    94|                this.services = servicesData.services || [];
    95|            }
    96|
    97|            // 加载Baidu translation settings
    98|            const baiduRes = await fetch(APIService.getApiUrl('/config/baidu_translate'));
    99|            this.baiduConfig = await baiduRes.json();
   100|
   101|            // 加载当前服务配置以获取current_services
   102|            const llmRes = await fetch(APIService.getApiUrl('/config/llm'));
   103|            const llmConfig = await llmRes.json();
   104|            if (llmConfig.provider) {
   105|                this.currentServices.llm = llmConfig.provider;
   106|            }
   107|
   108|            const vlmRes = await fetch(APIService.getApiUrl('/config/vision'));
   109|            const vlmConfig = await vlmRes.json();
   110|            if (vlmConfig.provider) {
   111|                this.currentServices.vlm = vlmConfig.provider;
   112|            }
   113|
   114|            logger.debug('配置加载完成', {
   115|                services: this.services.length,
   116|                currentLLM: this.currentServices.llm,
   117|                currentVLM: this.currentServices.vlm
   118|            });
   119|        } catch (error) {
   120|            logger.error('加载配置失败', error);
   121|            throw error;
   122|        }
   123|    }
   124|
   125|    /**
   126|     * Save所有配置
   127|     */
   128|    async _saveAllConfigs() {
   129|        try {
   130|            // SaveBaidu translation settings
   131|            await fetch(APIService.getApiUrl('/config/baidu_translate'), {
   132|                method: 'POST',
   133|                headers: { 'Content-Type': 'application/json' },
   134|                body: JSON.stringify(this.baiduConfig)
   135|            });
   136|
   137|            app.extensionManager.toast.add({
   138|                severity: "success",
   139|                summary: "Configuration saved",
   140|                life: 3000
   141|            });
   142|        } catch (error) {
   143|            logger.error('Save配置失败', error);
   144|            app.extensionManager.toast.add({
   145|                severity: "error",
   146|                summary: "Save failed",
   147|                detail: error.message,
   148|                life: 3000
   149|            });
   150|            throw error;
   151|        }
   152|    }
   153|
   154|    /**
   155|     * SaveBaidu translation settings
   156|     */
   157|    async _saveBaiduConfig() {
   158|        try {
   159|            await fetch(APIService.getApiUrl('/config/baidu_translate'), {
   160|                method: 'POST',
   161|                headers: { 'Content-Type': 'application/json' },
   162|                body: JSON.stringify(this.baiduConfig)
   163|            });
   164|
   165|            logger.debug('Baidu translation settings saved');
   166|
   167|            // 触发配置同步事件
   168|            this.notifyConfigChange();
   169|
   170|            // 显示成功提示
   171|            app.extensionManager.toast.add({
   172|                severity: "success",
   173|                summary: "Baidu translation settings saved",
   174|                life: 2000
   175|            });
   176|        } catch (error) {
   177|            logger.error('SaveBaidu translation settings失败', error);
   178|            app.extensionManager.toast.add({
   179|                severity: "error",
   180|                summary: "Save failed",
   181|                detail: error.message,
   182|                life: 3000
   183|            });
   184|        }
   185|    }
   186|
   187|    /**
   188|     * CreateAPI配置UI
   189|     */
   190|    _createAPIConfigUI(container) {
   191|        // Create标签页容器
   192|        const tabContainer = document.createElement('div');
   193|        tabContainer.className = 'api-config-tabs';
   194|
   195|        // Create标签页头部（动态生成所有Provider标签）
   196|        const tabHeader = this._createTabHeader();
   197|        tabContainer.appendChild(tabHeader);
   198|
   199|        // Create标签页内容容器
   200|        const tabContent = document.createElement('div');
   201|        tabContent.className = 'tab-content';
   202|
   203|        // CreateBaidu Translation标签页
   204|        const baiduContent = this._createBaiduTab();
   205|        tabContent.appendChild(baiduContent);
   206|
   207|        // 动态Create每个Provider的标签页内容
   208|        this.services.forEach(service => {
   209|            const serviceContent = this._createServiceContentTab(service);
   210|            tabContent.appendChild(serviceContent);
   211|        });
   212|
   213|        tabContainer.appendChild(tabContent);
   214|        container.appendChild(tabContainer);
   215|
   216|        // Default显示第一个标签页
   217|        this._switchTab('baidu', tabHeader, tabContent);
   218|    }
   219|
   220|    /**
   221|     * Create标签页头部（包含所有Provider）
   222|     */
   223|    _createTabHeader() {
   224|        const header = document.createElement('div');
   225|        header.className = 'tab-header';
   226|
   227|        // Baidu Translation标签
   228|        const baiduTab = this._createTabButton('baidu', tUI('Baidu Translation'), tUI('Machine Translation'));
   229|        header.appendChild(baiduTab);
   230|
   231|        // 动态CreateProvider标签
   232|        this.services.forEach(service => {
   233|            const tabButton = this._createTabButton(
   234|                service.id,
   235|                service.name || 'Untitled service',
   236|                service.description || ''
   237|            );
   238|            header.appendChild(tabButton);
   239|        });
   240|
   241|        // Create"+"新增标签按钮
   242|        const addButton = document.createElement('button');
   243|        addButton.className = 'service-tab-add';
   244|        addButton.innerHTML = '<i class="pi pi-plus"></i>';
   245|        addButton.addEventListener('click', () => this._addNewService(header, header.nextElementSibling));
   246|        header.appendChild(addButton);
   247|
   248|        // 初始化拖拽排序
   249|        new Sortable(header, {
   250|            handle: '.tab-button',
   251|            draggable: '.tab-button',
   252|            filter: '.service-tab-add',  // 排除"+"按钮
   253|            animation: 150,
   254|            onEnd: async (evt) => {
   255|                await this._updateServicesOrder();
   256|            }
   257|        });
   258|
   259|        return header;
   260|    }
   261|
   262|    /**
   263|     * 更New provider顺序
   264|     */
   265|    async _updateServicesOrder() {
   266|        try {
   267|            // 从DOM读取当前标签顺序
   268|            const header = document.querySelector('.tab-header');
   269|            const buttons = header.querySelectorAll('.tab-button');
   270|            const serviceIds = [];
   271|
   272|            buttons.forEach(btn => {
   273|                const tabId = btn.dataset.tab;
   274|                // 排除特殊标签(如Baidu Translation)
   275|                if (tabId && tabId !== 'baidu') {
   276|                    serviceIds.push(tabId);
   277|                }
   278|            });
   279|
   280|            // 调用后端APISave顺序
   281|            const res = await fetch(APIService.getApiUrl('/services/order'), {
   282|                method: 'PUT',
   283|                headers: { 'Content-Type': 'application/json' },
   284|                body: JSON.stringify({ service_ids: serviceIds })
   285|            });
   286|
   287|            const result = await res.json();
   288|
   289|            if (result.success) {
   290|                // 更新本地服务列表顺序
   291|                const orderedServices = [];
   292|                serviceIds.forEach(id => {
   293|                    const service = this.services.find(s => s.id === id);
   294|                    if (service) {
   295|                        orderedServices.push(service);
   296|                    }
   297|                });
   298|
   299|                // 添加未在orderedServices中的服务
   300|                this.services.forEach(s => {
   301|                    if (!orderedServices.find(os => os.id === s.id)) {
   302|                        orderedServices.push(s);
   303|                    }
   304|                });
   305|
   306|                this.services = orderedServices;
   307|
   308|                logger.debug('Provider顺序已更新', { order: serviceIds });
   309|
   310|                // 触发配置同步事件
   311|                this.notifyConfigChange();
   312|            } else {
   313|                throw new Error(result.error || 'Failed to update order');
   314|            }
   315|        } catch (error) {
   316|            logger.error('更New provider顺序失败', error);
   317|            app.extensionManager.toast.add({
   318|                severity: "error",
   319|                summary: "Failed to update order",
   320|                detail: error.message,
   321|                life: 3000
   322|            });
   323|        }
   324|    }
   325|
   326|
   327|    /**
   328|     * Create单个标签按钮
   329|     */
   330|    _createTabButton(tabId, title, subtitle) {
   331|        const button = document.createElement('button');
   332|        button.className = 'tab-button';
   333|        button.dataset.tab = tabId;
   334|
   335|        // 标签标题
   336|        const titleEl = document.createElement('div');
   337|        titleEl.className = 'tab-title';
   338|        titleEl.textContent = title;
   339|        button.appendChild(titleEl);
   340|
   341|        // 标签小字（介绍）
   342|        if (subtitle) {
   343|            const subtitleEl = document.createElement('div');
   344|            subtitleEl.className = 'tab-subtitle';
   345|            subtitleEl.textContent = subtitle;
   346|            button.appendChild(subtitleEl);
   347|        }
   348|
   349|        // 点击切换标签
   350|        button.addEventListener('click', () => {
   351|            this._switchTab(tabId, button.parentElement, button.parentElement.nextElementSibling);
   352|        });
   353|
   354|        // 为Provider标签添加右键菜单（Baidu Translation和预置Provider除外）
   355|        // 预置Provider不可编辑/Delete，只有用户自定义的Provider才能使用右键菜单
   356|        const isPresetService = APIConfigManager.PRESET_SERVICE_IDS.includes(tabId);
   357|        if (tabId !== 'baidu' && !isPresetService) {
   358|            this._attachServiceContextMenu(button, tabId, title);
   359|        }
   360|
   361|        return button;
   362|    }
   363|
   364|    /**
   365|     * 切换标签页
   366|     */
   367|    _switchTab(tabId, header, contentContainer) {
   368|        // 更新标签按钮状态
   369|        header.querySelectorAll('.tab-button').forEach(btn => {
   370|            if (btn.dataset.tab === tabId) {
   371|                btn.classList.add('active');
   372|            } else {
   373|                btn.classList.remove('active');
   374|            }
   375|        });
   376|
   377|        // 显示对应内容
   378|        contentContainer.querySelectorAll('.tab-pane').forEach(pane => {
   379|            pane.style.display = pane.dataset.tab === tabId ? 'block' : 'none';
   380|        });
   381|    }
   382|
   383|    /**
   384|     * 为服务标签附加右键菜单
   385|     */
   386|    _attachServiceContextMenu(button, serviceId, serviceName) {
   387|        createContextMenu({
   388|            target: button,
   389|            items: [
   390|                {
   391|                    label: 'Rename provider',
   392|                    icon: 'pi-pencil',
   393|                    onClick: () => {
   394|                        this._editServiceName(button, serviceId, serviceName);
   395|                    }
   396|                },
   397|                {
   398|                    separator: true
   399|                },
   400|                {
   401|                    label: 'Delete service',
   402|                    icon: 'pi-trash',
   403|                    danger: true,  // 标记为危险操作，图标显示红色
   404|                    onClick: () => {
   405|                        this._deleteService(serviceId, serviceName);
   406|                    }
   407|                }
   408|            ]
   409|        });
   410|    }
   411|
   412|    /**
   413|     * Rename provider
   414|     */
   415|    _editServiceName(triggerButton, serviceId, currentName) {
   416|        const service = this.services.find(s => s.id === serviceId);
   417|        if (!service) return;
   418|
   419|        createConfirmPopup({
   420|            target: triggerButton,
   421|            message: 'Edit provider information',
   422|            icon: 'pi-pencil',
   423|            position: 'bottom',
   424|            confirmLabel: 'Save',
   425|            cancelLabel: 'Cancel',
   426|            renderFormContent: (formContainer) => {
   427|                // Provider name输入框
   428|                const nameInput = createInputGroup('Provider name', 'Please enter a provider name');
   429|                nameInput.input.value = service.name || currentName;
   430|                nameInput.input.dataset.fieldName = 'serviceName';
   431|                formContainer.appendChild(nameInput.group);
   432|
   433|                // Provider description输入框
   434|                const descInput = createInputGroup('Provider description', 'Please enter a provider description (optional)');
   435|                descInput.input.value = service.description || '';
   436|                descInput.input.dataset.fieldName = 'serviceDescription';
   437|                formContainer.appendChild(descInput.group);
   438|            },
   439|            onConfirm: async (formContainer) => {
   440|                try {
   441|                    const nameInput = formContainer.querySelector('[data-field-name="serviceName"]');
   442|                    const descInput = formContainer.querySelector('[data-field-name="serviceDescription"]');
   443|
   444|                    const newName = nameInput.value.trim();
   445|                    const newDescription = descInput.value.trim();
   446|
   447|                    if (!newName) {
   448|                        app.extensionManager.toast.add({
   449|                            severity: "warn",
   450|                            summary: "Please enter a provider name",
   451|                            life: 2000
   452|                        });
   453|                        throw new Error('Provider name cannot be empty');
   454|                    }
   455|
   456|                    // 更新Provider information
   457|                    await this._updateService(serviceId, {
   458|                        name: newName,
   459|                        description: newDescription
   460|                    });
   461|
   462|                    // 更新按钮显示
   463|                    const titleEl = triggerButton.querySelector('.tab-title');
   464|                    const subtitleEl = triggerButton.querySelector('.tab-subtitle');
   465|
   466|                    if (titleEl) {
   467|                        titleEl.textContent = newName;
   468|                    }
   469|
   470|                    if (subtitleEl) {
   471|                        subtitleEl.textContent = newDescription;
   472|                    } else if (newDescription) {
   473|                        // 如果之前没有副标题，现在添加一个
   474|                        const newSubtitleEl = document.createElement('div');
   475|                        newSubtitleEl.className = 'tab-subtitle';
   476|                        newSubtitleEl.textContent = newDescription;
   477|                        triggerButton.appendChild(newSubtitleEl);
   478|                    }
   479|
   480|                    app.extensionManager.toast.add({
   481|                        severity: "success",
   482|                        summary: "Provider information updated",
   483|                        detail: `${newName} ${tUI('updated successfully')}`,
   484|                        life: 2000
   485|                    });
   486|                } catch (error) {
   487|                    logger.error('Failed to update provider information', error);
   488|                    app.extensionManager.toast.add({
   489|                        severity: "error",
   490|                        summary: "Update failed",
   491|                        detail: error.message,
   492|                        life: 3000
   493|                    });
   494|                    throw error;
   495|                }
   496|            }
   497|        });
   498|    }
   499|
   500|
   501|    /**
   502|     * CreateProvider内容标签页
   503|     */
   504|    _createServiceContentTab(service) {
   505|        const pane = document.createElement('div');
   506|        pane.className = 'tab-pane';
   507|        pane.dataset.tab = service.id;
   508|        pane.style.display = 'none';
   509|        pane.style.padding = '16px';
   510|
   511|        // Provider配置卡片（复用现有的卡片Create逻辑）
   512|        const card = this._createServiceCard(service);
   513|        pane.appendChild(card);
   514|
   515|        return pane;
   516|    }
   517|
   518|    /**
   519|     * 新增Provider
   520|     */
   521|    async _addNewService(headerElement, contentElement) {
   522|        // 获取触发按钮作为定位参考
   523|        const triggerButton = headerElement.querySelector('.service-tab-add');
   524|
   525|        // 显示确认气泡框
   526|        createConfirmPopup({
   527|            target: triggerButton,
   528|            message: 'Create new provider',
   529|            icon: 'pi-plus-circle',
   530|            position: 'left',
   531|            confirmLabel: 'Create',
   532|            cancelLabel: 'Cancel',
   533|            renderFormContent: (formContainer) => {
   534|                // Provider name输入框
   535|                const nameInput = createInputGroup('Provider name', 'Please enter a provider name');
   536|                nameInput.input.value = tUI('New provider');
   537|                nameInput.input.dataset.fieldName = 'serviceName';
   538|                formContainer.appendChild(nameInput.group);
   539|
   540|                // Provider description输入框
   541|                const descInput = createInputGroup('Provider description', 'Please enter a provider description (optional)');
   542|                descInput.input.dataset.fieldName = 'serviceDescription';
   543|                formContainer.appendChild(descInput.group);
   544|            },
   545|            onConfirm: async (formContainer) => {
   546|                try {
   547|                    // 获取表单数据
   548|                    const nameInput = formContainer.querySelector('[data-field-name="serviceName"]');
   549|                    const descInput = formContainer.querySelector('[data-field-name="serviceDescription"]');
   550|
   551|                    const serviceName = nameInput.value.trim();
   552|                    const serviceDescription = descInput.value.trim();
   553|
   554|                    if (!serviceName) {
   555|                        app.extensionManager.toast.add({
   556|                            severity: "warn",
   557|                            summary: "Please enter a provider name",
   558|                            life: 2000
   559|                        });
   560|                        throw new Error('Provider name cannot be empty');
   561|                    }
   562|
   563|                    // CreateProvider
   564|                    const res = await fetch(APIService.getApiUrl('/services'), {
   565|                        method: 'POST',
   566|                        headers: { 'Content-Type': 'application/json' },
   567|                        body: JSON.stringify({
   568|                            type: 'openai_compatible',
   569|                            name: serviceName,
   570|                            description: serviceDescription,
   571|                            base_url: 'https://api.example.com/v1',
   572|                            api_key: ''
   573|                        })
   574|                    });
   575|
   576|                    const result = await res.json();
   577|
   578|                    if (result.success) {
   579|                        app.extensionManager.toast.add({
   580|                            severity: "success",
   581|                            summary: "New provider created",
   582|                            detail: `${serviceName} ${tUI('created successfully')}`,
   583|                            life: 3000
   584|                        });
   585|
   586|                        // 重新加载配置
   587|                        await this._loadAllConfigs();
   588|
   589|                        // 获取新Create的服务
   590|                        const newService = this.services.find(s => s.id === result.service_id);
   591|                        if (newService) {
   592|                            // Create新标签按钮（插入到"+"按钮前）
   593|                            const addButton = headerElement.querySelector('.service-tab-add');
   594|                            const newTabButton = this._createTabButton(
   595|                                newService.id,
   596|                                newService.name || 'Untitled service',
   597|                                newService.description || ''
   598|                            );
   599|                            headerElement.insertBefore(newTabButton, addButton);
   600|
   601|                            // Create新内容标签页
   602|                            const newContentPane = this._createServiceContentTab(newService);
   603|                            contentElement.appendChild(newContentPane);
   604|
   605|                            // 切换到新标签
   606|                            this._switchTab(newService.id, headerElement, contentElement);
   607|                        }
   608|
   609|                        // 触发配置同步事件
   610|                        this.notifyConfigChange();
   611|                    } else {
   612|                        throw new Error(result.error || 'Creation failed');
   613|                    }
   614|                } catch (error) {
   615|                    logger.error('Failed to create provider', error);
   616|                    app.extensionManager.toast.add({
   617|                        severity: "error",
   618|                        summary: "Creation failed",
   619|                        detail: error.message,
   620|                        life: 3000
   621|                    });
   622|                    throw error;
   623|                }
   624|            }
   625|        });
   626|    }
   627|
   628|    /**
   629|     * CreateBaidu Translation标签页
   630|     */
   631|    _createBaiduTab() {
   632|        const pane = document.createElement('div');
   633|        pane.className = 'tab-pane';
   634|        pane.dataset.tab = 'baidu';
   635|
   636|        const section = createFormGroup('Baidu translation settings', [
   637|            { text: 'Activate Baidu Translation service', url: 'https://fanyi-api.baidu.com/' }
   638|        ]);
   639|        section.classList.add('baidu-translate-section');
   640|
   641|        // 为链接添加图标,与其他服务保持统一
   642|        const linkElement = section.querySelector('.settings-service-link');
   643|        if (linkElement) {
   644|            const icon = document.createElement('i');
   645|            icon.className = 'pi pi-star';
   646|            icon.style.marginRight = '4px';
   647|            linkElement.insertBefore(icon, linkElement.firstChild);
   648|        }
   649|
   650|        const appIdInput = createInputGroup('App ID', 'Please enter the Baidu Translation App ID');
   651|        appIdInput.input.value = this.baiduConfig.app_id || '';
   652|        appIdInput.input.addEventListener('input', (e) => {
   653|            this.baiduConfig.app_id = e.target.value;
   654|        });
   655|        // 添加失焦Save
   656|        appIdInput.input.addEventListener('blur', async () => {
   657|            await this._saveBaiduConfig();
   658|        });
   659|
   660|        const secretInput = createInputGroup('Secret Key', 'Please enter the Baidu Translation secret key');
   661|        secretInput.input.type = 'password';
   662|        secretInput.input.value = this.baiduConfig.secret_key || '';
   663|        secretInput.input.addEventListener('input', (e) => {
   664|            this.baiduConfig.secret_key = e.target.value;
   665|        });
   666|        // 添加失焦Save
   667|        secretInput.input.addEventListener('blur', async () => {
   668|            await this._saveBaiduConfig();
   669|        });
   670|
   671|        section.appendChild(appIdInput.group);
   672|        section.appendChild(secretInput.group);
   673|        pane.appendChild(section);
   674|
   675|        return pane;
   676|    }
   677|
   678|    /**
   679|     * Create通用Provider标签页（二级标签页结构）
   680|     */
   681|    _createServicesTab() {
   682|        const pane = document.createElement('div');
   683|        pane.className = 'tab-pane services-tab-pane';
   684|        pane.dataset.tab = 'services';
   685|        // 样式已移至CSS
   686|
   687|        // 二级标签页导航
   688|        const subTabNav = document.createElement('div');
   689|        subTabNav.className = 'service-sub-tabs';
   690|        // 样式已移至CSS
   691|
   692|        // 二级标签页内容容器
   693|        const subTabContent = document.createElement('div');
   694|        subTabContent.className = 'service-sub-content';
   695|
   696|        // 获取通用Provider
   697|        const genericServices = this.services.filter(s => s.type === 'openai_compatible');
   698|
   699|        // CreateProvider标签
   700|        genericServices.forEach((service, index) => {
   701|            // Create标签按钮
   702|            const tabButton = this._createServiceTabButton(service);
   703|            subTabNav.appendChild(tabButton);
   704|
   705|            // Create标签内容
   706|            const tabContentPane = this._createServiceTabContent(service);
   707|            subTabContent.appendChild(tabContentPane);
   708|
   709|            // Default选中第一个
   710|            if (index === 0) {
   711|                tabButton.classList.add('active');
   712|                tabContentPane.style.display = 'block';
   713|            }
   714|        });
   715|
   716|        // Create"+"新增标签按钮
   717|        const addTabButton = document.createElement('button');
   718|        addTabButton.className = 'service-tab-add';
   719|        addTabButton.textContent = '+';
   720|        addTabButton.addEventListener('click', () => this._addNewServiceTab(subTabNav, subTabContent));
   721|        subTabNav.appendChild(addTabButton);
   722|
   723|        // 如果没有任何Provider，显示空状态
   724|        if (genericServices.length === 0) {
   725|            const emptyHint = document.createElement('div');
   726|            emptyHint.className = 'empty-state-hint';
   727|            emptyHint.innerHTML = `
   728|                <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
   729|                <div style="font-size: 16px; margin-bottom: 8px;">No providers yet</div>
   730|                <div style="font-size: 14px;">Click the "+" button in the upper-right corner to add your first provider</div>
   731|            `;
   732|            subTabContent.appendChild(emptyHint);
   733|        }
   734|
   735|        pane.appendChild(subTabNav);
   736|        pane.appendChild(subTabContent);
   737|        return pane;
   738|    }
   739|
   740|    /**
   741|     * CreateProvider标签按钮
   742|     */
   743|    _createServiceTabButton(service) {
   744|        const button = document.createElement('button');
   745|        button.className = 'service-tab-button';
   746|        button.dataset.serviceId = service.id;
   747|
   748|        // 标签标题
   749|        const title = document.createElement('div');
   750|        title.className = 'service-tab-title';
   751|        title.textContent = service.name || 'Untitled service';
   752|
   753|        // 标签小字（介绍）
   754|        const subtitle = document.createElement('div');
   755|        subtitle.className = 'service-tab-subtitle';
   756|        subtitle.textContent = service.description || '';
   757|
   758|        button.appendChild(title);
   759|        if (service.description) {
   760|            button.appendChild(subtitle);
   761|        }
   762|
   763|        // 点击切换
   764|        button.addEventListener('click', () => {
   765|            this._switchServiceTab(service.id);
   766|        });
   767|
   768|        return button;
   769|    }
   770|
   771|    /**
   772|     * 切换Provider标签
   773|     */
   774|    _switchServiceTab(serviceId) {
   775|        const container = document.querySelector('.services-tab-pane');
   776|        if (!container) return;
   777|
   778|        // 更新标签按钮状态
   779|        const buttons = container.querySelectorAll('.service-tab-button');
   780|        buttons.forEach(btn => {
   781|            if (btn.dataset.serviceId === serviceId) {
   782|                btn.classList.add('active');
   783|                btn.style.background = 'var(--p-primary-500)';
   784|                btn.style.color = 'white';
   785|                btn.querySelector('.service-tab-title').style.color = 'white';
   786|                const subtitle = btn.querySelector('.service-tab-subtitle');
   787|                if (subtitle) {
   788|                    subtitle.style.color = 'rgba(255, 255, 255, 0.8)';
   789|                }
   790|            } else {
   791|                btn.classList.remove('active');
   792|                btn.style.background = 'transparent';
   793|                btn.style.color = 'var(--p-text-color)';
   794|                btn.querySelector('.service-tab-title').style.color = 'var(--p-text-color)';
   795|                const subtitle = btn.querySelector('.service-tab-subtitle');
   796|                if (subtitle) {
   797|                    subtitle.style.color = 'var(--p-text-muted-color)';
   798|                }
   799|            }
   800|        });
   801|
   802|        // 更新内容显示
   803|        const panes = container.querySelectorAll('.service-content-pane');
   804|        panes.forEach(pane => {
   805|            pane.style.display = pane.dataset.serviceId === serviceId ? 'block' : 'none';
   806|        });
   807|    }
   808|
   809|    /**
   810|     * CreateProvider标签内容
   811|     */
   812|    _createServiceTabContent(service) {
   813|        const contentPane = document.createElement('div');
   814|        contentPane.className = 'service-content-pane';
   815|        contentPane.dataset.serviceId = service.id;
   816|        contentPane.style.cssText = `
   817|            display: none;
   818|        `;
   819|
   820|        // 这里先Create一个简单的占位内容，后续会完善
   821|        const card = this._createServiceCard(service);
   822|        contentPane.appendChild(card);
   823|
   824|        return contentPane;
   825|    }
   826|
   827|    /**
   828|     * 添加New provider标签
   829|     */
   830|    async _addNewServiceTab(navContainer, contentContainer) {
   831|        // 调用后端APICreateNew provider
   832|        try {
   833|            const res = await fetch(APIService.getApiUrl('/services'), {
   834|                method: 'POST',
   835|                headers: { 'Content-Type': 'application/json' },
   836|                body: JSON.stringify({
   837|                    type: 'openai_compatible',
   838|                    name: tUI('New provider'),
   839|                    description: '',
   840|                    base_url: 'https://api.example.com/v1',
   841|                    api_key: ''
   842|                })
   843|            });
   844|
   845|            const result = await res.json();
   846|
   847|            if (result.success) {
   848|                app.extensionManager.toast.add({
   849|                    severity: "success",
   850|                    summary: "New provider created",
   851|                    detail: tUI("Please fill in the configuration fields"),
   852|                    life: 3000
   853|                });
   854|
   855|                // 重新加载配置
   856|                await this._loadAllConfigs();
   857|
   858|                // 获取新Create的服务
   859|                const newService = this.services.find(s => s.id === result.service_id);
   860|                if (newService) {
   861|                    // Create新标签按钮（插入到"+"按钮前）
   862|                    const newTabButton = this._createServiceTabButton(newService);
   863|                    const addButton = navContainer.querySelector('.service-tab-add');
   864|                    navContainer.insertBefore(newTabButton, addButton);
   865|
   866|                    // Create新内容
   867|                    const newContentPane = this._createServiceTabContent(newService);
   868|                    contentContainer.appendChild(newContentPane);
   869|
   870|                    // 移除空状态提示（如果有）
   871|                    const emptyHint = contentContainer.querySelector('.empty-state-hint');
   872|                    if (emptyHint) {
   873|                        emptyHint.remove();
   874|                    }
   875|
   876|                    // 切换到新标签
   877|                    this._switchServiceTab(newService.id);
   878|                }
   879|            } else {
   880|                throw new Error(result.error || 'Creation failed');
   881|            }
   882|        } catch (error) {
   883|            logger.error('Failed to create provider', error);
   884|            app.extensionManager.toast.add({
   885|                severity: "error",
   886|                summary: "Creation failed",
   887|                detail: error.message,
   888|                life: 3000
   889|            });
   890|        }
   891|    }
   892|
   893|    /**
   894|     * CreateOllama标签页
   895|     */
   896|    _createOllamaTab() {
   897|        const pane = document.createElement('div');
   898|        pane.className = 'tab-pane';
   899|        pane.dataset.tab = 'ollama';
   900|        // 样式已移至CSS
   901|
   902|        const ollamaService = this.services.find(s => s.type === 'ollama');
   903|
   904|        if (ollamaService) {
   905|            const card = this._createServiceCard(ollamaService);
   906|            pane.appendChild(card);
   907|        } else {
   908|            const hint = document.createElement('div');
   909|            hint.className = 'empty-state-hint-small';
   910|            hint.textContent = 'Ollama service is not configured';
   911|            pane.appendChild(hint);
   912|        }
   913|
   914|        return pane;
   915|    }
   916|
   917|    /**
   918|     * CreateProvider卡片
   919|     */
   920|    _createServiceCard(service) {
   921|        const card = document.createElement('div');
   922|        card.className = 'service-card';
   923|        card.dataset.serviceId = service.id;  // 添加serviceId到dataset
   924|
   925|        // Provider标题 - 根据服务名称检测是否需要添加外部链接
   926|        const titleText = service.name || service.id;
   927|        const descText = service.description ? ` ${tUI('Info configuration')}` : '';
   928|        const fullTitle = `1️⃣ ${titleText}${descText}`;
   929|
   930|        // 检测服务名称,添加对应的申请链接
   931|        const links = [];
   932|        const serviceName = (service.name || '').toLowerCase();
   933|        const serviceId = (service.id || '').toLowerCase();
   934|        const searchText = `${serviceName} ${serviceId}`.toLowerCase();
   935|
   936|        // 智谱服务检测
   937|        if (searchText.includes('智谱') || searchText.includes('zhipu')) {
   938|            links.push({
   939|                text: 'Activate Zhipu API service',
   940|                url: 'https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D',
   941|                icon: 'pi-star'
   942|            });
   943|        }
   944|
   945|        // 硅基流动服务检测
   946|        if (searchText.includes('硅基') || searchText.includes('siliconflow') || searchText.includes('silicon')) {
   947|            links.push({
   948|                text: 'Activate SiliconFlow API service',
   949|                url: 'https://cloud.siliconflow.cn/i/FCDL2zBQ',
   950|                icon: 'pi-star'
   951|            });
   952|        }
   953|
   954|        // xflow服务检测
   955|        if (searchText.includes('xflow')) {
   956|            links.push({
   957|                text: 'Activate xFlow API service',
   958|                url: 'https://api.xflow.cc/register?aff=Z063',
   959|                icon: 'pi-star'
   960|            });
   961|        }
   962|
   963|        // 使用createFormGroupCreate带链接的标题,或者普通标题
   964|        let titleSection;
   965|        if (links.length > 0) {
   966|            titleSection = createFormGroup(fullTitle, links.map(link => ({
   967|                text: link.text,
   968|                url: link.url
   969|            })));
   970|            // 为链接添加图标
   971|            const linkElements = titleSection.querySelectorAll('.settings-service-link');
   972|            linkElements.forEach((linkElem, index) => {
   973|                if (links[index] && links[index].icon) {
   974|                    const icon = document.createElement('i');
   975|                    icon.className = `pi ${links[index].icon}`;
   976|                    icon.style.marginRight = '4px';
   977|                    linkElem.insertBefore(icon, linkElem.firstChild);
   978|                }
   979|            });
   980|        } else {
   981|            // 没有链接时,Create普通标题
   982|            titleSection = document.createElement('div');
   983|            titleSection.className = 'settings-form-section';
   984|            const titleElement = document.createElement('h3');
   985|            titleElement.className = 'settings-form-section-title';
   986|            titleElement.textContent = fullTitle;
   987|            titleSection.appendChild(titleElement);
   988|        }
   989|
   990|        // 如果是 Ollama 服务，在标题后方添加提示 tooltip
   991|        if (service.type === 'ollama') {
   992|            const titleElement = titleSection.querySelector('.settings-form-section-title');
   993|            if (titleElement) {
   994|                // 确保 h3 可以包含其他元素，设置为 flex 以对齐图标
   995|                titleElement.style.display = 'inline-flex';
   996|                titleElement.style.alignItems = 'center';
   997|
   998|                const icon = document.createElement('i');
   999|                icon.className = 'pi pi-info-circle service-setting-info-icon';
  1000|                icon.style.marginLeft = '8px';
  1001|                icon.style.fontSize = '14px';
  1002|                icon.style.color = 'var(--p-text-muted-color)';
  1003|                icon.style.cursor = 'help';
  1004|                titleElement.appendChild(icon);
  1006|                createTooltip({
  1007|                    target: icon,
  1008|                    content: 'Do not append /v1 to the Base URL unless you need OpenAI-compatible requests. Without /v1, Ollama uses its native API; with /v1, it uses the OpenAI-compatible request format.',
  1009|                    position: 'top'
  1010|                });
  1011|            }
  1012|        }
  1013|
  1014|        card.appendChild(titleSection);
  1015|
  1016|        // 基本信息
  1017|        const baseUrlInput = createInputGroup('Base URL', 'https://api.example.com/v1');
  1018|        baseUrlInput.input.value = service.base_url || '';
  1019|        // 智谱和 xflow 服务的 Base URL 禁用修改
  1020|        if (service.id === 'zhipu' || service.id === 'xFlow') {
  1021|            baseUrlInput.input.disabled = true;
  1022|            baseUrlInput.input.title = tUI('The Base URL for this preset provider cannot be changed');
  1023|            baseUrlInput.input.classList.add('pa-input-disabled');
  1024|        }
  1025|
  1026|        baseUrlInput.input.addEventListener('change', async (e) => {
  1027|            await this._updateService(service.id, { base_url: e.target.value });
  1028|        });
  1029|
  1030|        // API Key输入框（简化版，直接使用明文）
  1031|        const apiKeyInput = createInputGroup('API Key', 'Please enter the API key');
  1032|        apiKeyInput.input.type = 'password';
  1033|        apiKeyInput.input.value = service.api_key || '';
  1034|
  1035|        // 失焦时Save
  1036|        apiKeyInput.input.addEventListener('blur', async (e) => {
  1037|            const newApiKey = e.target.value.trim();
  1038|            if (newApiKey !== service.api_key) {
  1039|                await this._updateService(service.id, { api_key: newApiKey });
  1040|                service.api_key = newApiKey;
  1041|            }
  1042|        });
  1043|
  1044|        card.appendChild(baseUrlInput.group);
  1045|        card.appendChild(apiKeyInput.group);
  1046|
  1047|        // === 服务配置区域（简化版） ===
  1048|        // Create配置项容器
  1049|        const settingsInlineContainer = document.createElement('div');
  1050|        settingsInlineContainer.className = 'service-settings-inline';
  1051|
  1052|        // 思维链控制开关
  1053|        const thinkingContainer = document.createElement('div');
  1054|        thinkingContainer.className = 'service-setting-item';
  1055|
  1056|        const thinkingLabel = document.createElement('span');
  1057|        thinkingLabel.className = 'service-setting-label';
  1058|        thinkingLabel.textContent = tUI('Disable chain-of-thought');
  1059|
  1060|        const thinkingIcon = document.createElement('i');
  1061|        thinkingIcon.className = 'pi pi-info-circle service-setting-info-icon';
  1062|
  1063|        // 添加 tooltip
  1064|        createTooltip({
  1065|            target: thinkingIcon,
  1066|            content: 'Disable chain-of-thought for models that support it. ⚠️ Not all models support this; models with chain-of-thought disabled will show an extra “✏️” symbol after the model info in logs.',
  1067|            position: 'top'
  1068|        });
  1069|
  1070|        const thinkingLabelWrapper = document.createElement('div');
  1071|        thinkingLabelWrapper.className = 'service-setting-label-wrapper';
  1072|        thinkingLabelWrapper.appendChild(thinkingLabel);
  1073|        thinkingLabelWrapper.appendChild(thinkingIcon);
  1074|
  1075|        // Create开关
  1076|        const thinkingSwitchWrapper = document.createElement('label');
  1077|        thinkingSwitchWrapper.className = 'switch-wrapper';
  1078|
  1079|        const thinkingInput = document.createElement('input');
  1080|        thinkingInput.type = 'checkbox';
  1081|        thinkingInput.checked = service.disable_thinking ?? true;
  1082|
  1083|        const thinkingSlider = document.createElement('span');
  1084|        thinkingSlider.className = `switch-slider${thinkingInput.checked ? ' checked' : ''}`;
  1085|
  1086|        const thinkingButton = document.createElement('span');
  1087|        thinkingButton.className = `switch-button${thinkingInput.checked ? ' checked' : ''}`;
  1088|        thinkingSlider.appendChild(thinkingButton);
  1089|
  1090|        thinkingInput.addEventListener('change', async (e) => {
  1091|            const isChecked = e.target.checked;
  1092|            if (isChecked) {
  1093|                thinkingSlider.classList.add('checked');
  1094|                thinkingButton.classList.add('checked');
  1095|            } else {
  1096|                thinkingSlider.classList.remove('checked');
  1097|                thinkingButton.classList.remove('checked');
  1098|            }
  1099|            await this._updateService(service.id, { disable_thinking: isChecked });
  1100|            service.disable_thinking = isChecked;
  1101|        });
  1102|
  1103|        thinkingSwitchWrapper.appendChild(thinkingInput);
  1104|        thinkingSwitchWrapper.appendChild(thinkingSlider);
  1105|
  1106|        thinkingContainer.appendChild(thinkingLabelWrapper);
  1107|        thinkingContainer.appendChild(thinkingSwitchWrapper);
  1108|        settingsInlineContainer.appendChild(thinkingContainer);
  1109|
  1110|        // ---Enable advanced parameters开关---
  1111|        const advancedParamsContainer = document.createElement('div');
  1112|        advancedParamsContainer.className = 'service-setting-item';
  1113|
  1114|        const advancedParamsLabel = document.createElement('span');
  1115|        advancedParamsLabel.className = 'service-setting-label';
  1116|        advancedParamsLabel.textContent = tUI('Enable advanced parameters');
  1117|
  1118|        const advancedParamsIcon = document.createElement('i');
  1119|        advancedParamsIcon.className = 'pi pi-info-circle service-setting-info-icon';
  1120|
  1121|        // 添加 tooltip
  1122|        createTooltip({
  1123|            target: advancedParamsIcon,
  1124|            content: 'When enabled, temperature, top_p, and max_tokens will be sent to fine-tune model behavior and speed up generation by limiting the maximum token count. Disable it for better compatibility.',
  1125|            position: 'top'
  1126|        });
  1127|
  1128|        const advancedParamsLabelWrapper = document.createElement('div');
  1129|        advancedParamsLabelWrapper.className = 'service-setting-label-wrapper';
  1130|        advancedParamsLabelWrapper.appendChild(advancedParamsLabel);
  1131|        advancedParamsLabelWrapper.appendChild(advancedParamsIcon);
  1132|
  1133|        // Create开关
  1134|        const advancedParamsSwitchWrapper = document.createElement('label');
  1135|        advancedParamsSwitchWrapper.className = 'switch-wrapper';
  1136|
  1137|        const advancedParamsInput = document.createElement('input');
  1138|        advancedParamsInput.type = 'checkbox';
  1139|        advancedParamsInput.checked = service.enable_advanced_params ?? false;
  1140|
  1141|        const advancedParamsSlider = document.createElement('span');
  1142|        advancedParamsSlider.className = `switch-slider${advancedParamsInput.checked ? ' checked' : ''}`;
  1143|
  1144|        const advancedParamsButton = document.createElement('span');
  1145|        advancedParamsButton.className = `switch-button${advancedParamsInput.checked ? ' checked' : ''}`;
  1146|        advancedParamsSlider.appendChild(advancedParamsButton);
  1147|
  1148|        advancedParamsInput.addEventListener('change', async (e) => {
  1149|            const isChecked = e.target.checked;
  1150|            if (isChecked) {
  1151|                advancedParamsSlider.classList.add('checked');
  1152|                advancedParamsButton.classList.add('checked');
  1153|            } else {
  1154|                advancedParamsSlider.classList.remove('checked');
  1155|                advancedParamsButton.classList.remove('checked');
  1156|            }
  1157|            await this._updateService(service.id, { enable_advanced_params: isChecked });
  1158|            service.enable_advanced_params = isChecked;
  1159|        });
  1160|
  1161|        advancedParamsSwitchWrapper.appendChild(advancedParamsInput);
  1162|        advancedParamsSwitchWrapper.appendChild(advancedParamsSlider);
  1163|
  1164|        advancedParamsContainer.appendChild(advancedParamsLabelWrapper);
  1165|        advancedParamsContainer.appendChild(advancedParamsSwitchWrapper);
  1166|        settingsInlineContainer.appendChild(advancedParamsContainer);
  1167|
  1168|        // ---Filter chain-of-thought output开关---
  1169|        const filterThinkingContainer = document.createElement('div');
  1170|        filterThinkingContainer.className = 'service-setting-item';
  1171|
  1172|        const filterThinkingLabel = document.createElement('span');
  1173|        filterThinkingLabel.className = 'service-setting-label';
  1174|        filterThinkingLabel.textContent = tUI('Filter chain-of-thought output');
  1175|
  1176|        const filterThinkingIcon = document.createElement('i');
  1177|        filterThinkingIcon.className = 'pi pi-info-circle service-setting-info-icon';
  1178|
  1179|        // 添加 tooltip
  1180|        createTooltip({
  1181|            target: filterThinkingIcon,
  1182|            content: 'For models that cannot disable chain-of-thought, remove the reasoning text. Enabled by default.',
  1183|            position: 'top'
  1184|        });
  1185|
  1186|        const filterThinkingLabelWrapper = document.createElement('div');
  1187|        filterThinkingLabelWrapper.className = 'service-setting-label-wrapper';
  1188|        filterThinkingLabelWrapper.appendChild(filterThinkingLabel);
  1189|        filterThinkingLabelWrapper.appendChild(filterThinkingIcon);
  1190|
  1191|        // Create开关
  1192|        const filterThinkingSwitchWrapper = document.createElement('label');
  1193|        filterThinkingSwitchWrapper.className = 'switch-wrapper';
  1194|
  1195|        const filterThinkingInput = document.createElement('input');
  1196|        filterThinkingInput.type = 'checkbox';
  1197|        filterThinkingInput.checked = service.filter_thinking_output ?? true;
  1198|
  1199|        const filterThinkingSlider = document.createElement('span');
  1200|        filterThinkingSlider.className = `switch-slider${filterThinkingInput.checked ? ' checked' : ''}`;
  1201|
  1202|        const filterThinkingButton = document.createElement('span');
  1203|        filterThinkingButton.className = `switch-button${filterThinkingInput.checked ? ' checked' : ''}`;
  1204|        filterThinkingSlider.appendChild(filterThinkingButton);
  1205|
  1206|        filterThinkingInput.addEventListener('change', async (e) => {
  1207|            const isChecked = e.target.checked;
  1208|            if (isChecked) {
  1209|                filterThinkingSlider.classList.add('checked');
  1210|                filterThinkingButton.classList.add('checked');
  1211|            } else {
  1212|                filterThinkingSlider.classList.remove('checked');
  1213|                filterThinkingButton.classList.remove('checked');
  1214|            }
  1215|            await this._updateService(service.id, { filter_thinking_output: isChecked });
  1216|            service.filter_thinking_output = isChecked;
  1217|        });
  1218|
  1219|        filterThinkingSwitchWrapper.appendChild(filterThinkingInput);
  1220|        filterThinkingSwitchWrapper.appendChild(filterThinkingSlider);
  1221|
  1222|        filterThinkingContainer.appendChild(filterThinkingLabelWrapper);
  1223|        filterThinkingContainer.appendChild(filterThinkingSwitchWrapper);
  1224|        settingsInlineContainer.appendChild(filterThinkingContainer);
  1225|
  1226|        // Ollama专属:Auto-unload model开关(仅前端UI)
  1227|        if (service.type === 'ollama') {
  1228|            const autoUnloadContainer = document.createElement('div');
  1229|            autoUnloadContainer.className = 'service-setting-item';
  1230|
  1231|            const autoUnloadLabel = document.createElement('span');
  1232|            autoUnloadLabel.className = 'service-setting-label';
  1233|            autoUnloadLabel.textContent = tUI('Auto-unload model');
  1234|
  1235|            const autoUnloadIcon = document.createElement('i');
  1236|            autoUnloadIcon.className = 'pi pi-info-circle service-setting-info-icon';
  1237|
  1238|            // 添加 tooltip
  1239|            createTooltip({
  1240|                target: autoUnloadIcon,
  1241|                content: 'Automatically unload the model after the request completes to free VRAM. ⚠️ This setting applies to the front-end assistant only; nodes have their own separate option.',
  1242|                position: 'top'
  1243|            });
  1244|
  1245|            const autoUnloadLabelWrapper = document.createElement('div');
  1246|            autoUnloadLabelWrapper.className = 'service-setting-label-wrapper';
  1247|            autoUnloadLabelWrapper.appendChild(autoUnloadLabel);
  1248|            autoUnloadLabelWrapper.appendChild(autoUnloadIcon);
  1249|
  1250|            // Create开关
  1251|            const autoUnloadSwitchWrapper = document.createElement('label');
  1252|            autoUnloadSwitchWrapper.className = 'switch-wrapper';
  1253|
  1254|            const autoUnloadInput = document.createElement('input');
  1255|            autoUnloadInput.type = 'checkbox';
  1256|            autoUnloadInput.checked = service.auto_unload !== false;
  1257|
  1258|            const autoUnloadSlider = document.createElement('span');
  1259|            autoUnloadSlider.className = `switch-slider${autoUnloadInput.checked ? ' checked' : ''}`;
  1260|
  1261|            const autoUnloadButton = document.createElement('span');
  1262|            autoUnloadButton.className = `switch-button${autoUnloadInput.checked ? ' checked' : ''}`;
  1263|            autoUnloadSlider.appendChild(autoUnloadButton);
  1264|
  1265|            autoUnloadInput.addEventListener('change', async (e) => {
  1266|                const isChecked = e.target.checked;
  1267|                if (isChecked) {
  1268|                    autoUnloadSlider.classList.add('checked');
  1269|                    autoUnloadButton.classList.add('checked');
  1270|                } else {
  1271|                    autoUnloadSlider.classList.remove('checked');
  1272|                    autoUnloadButton.classList.remove('checked');
  1273|                }
  1274|                await this._updateService(service.id, { auto_unload: isChecked });
  1275|                service.auto_unload = isChecked;
  1276|            });
  1277|
  1278|            autoUnloadSwitchWrapper.appendChild(autoUnloadInput);
  1279|            autoUnloadSwitchWrapper.appendChild(autoUnloadSlider);
  1280|
  1281|            autoUnloadContainer.appendChild(autoUnloadLabelWrapper);
  1282|            autoUnloadContainer.appendChild(autoUnloadSwitchWrapper);
  1283|            settingsInlineContainer.appendChild(autoUnloadContainer);
  1284|        }
  1285|
  1286|        card.appendChild(settingsInlineContainer);
  1287|
  1288|        // LLM模型部分
  1289|        const llmSection = this._createModelSection(service, 'llm');
  1290|        card.appendChild(llmSection);
  1291|
  1292|        // VLM模型部分
  1293|        const vlmSection = this._createModelSection(service, 'vlm');
  1294|        card.appendChild(vlmSection);
  1295|
  1296|        return card;
  1297|    }
  1298|
  1299|
  1300|    /**
  1301|     * Create模型配置部分
  1302|     */
  1303|    _createModelSection(service, modelType) {
  1304|        const section = document.createElement('div');
  1305|        section.className = 'settings-form-section';
  1306|        section.style.marginTop = '16px';
  1307|
  1308|        // 标题行（包含模型类型和+按钮）
  1309|        const titleRow = document.createElement('div');
  1310|        titleRow.style.cssText = `
  1311|            display: flex;
  1312|            justify-content: space-between;
  1313|            align-items: center;
  1314|            margin-bottom: 12px;
  1315|        `;
  1316|
  1317|        const title = document.createElement('h5');
  1318|        title.className = 'settings-form-section-title';
  1319|        title.textContent = modelType === 'llm'
  1320|            ? tUI('2️⃣ Add large language models (LLMs) for translation and prompt optimization')
  1321|            : tUI('3️⃣ Add vision models (VLMs) for image and video captioning');
  1322|        title.style.margin = '0';
  1323|        title.style.display = 'inline-flex';
  1324|        title.style.alignItems = 'center';
  1325|
  1326|        const modelHintIcon = document.createElement('i');
  1327|        modelHintIcon.className = 'pi pi-exclamation-circle service-setting-info-icon';
  1328|        modelHintIcon.style.marginLeft = '8px';
  1329|        modelHintIcon.style.fontSize = '14px';
  1330|        modelHintIcon.style.color = 'var(--p-text-muted-color)';
  1331|        modelHintIcon.style.cursor = 'help';
  1332|        title.appendChild(modelHintIcon);
  1333|
  1334|        createTooltip({
  1335|            target: modelHintIcon,
  1336|            content: 'Prefer non-reasoning or instruction-tuned (-instruct) models to reduce chain-of-thought output, truncation, and unstable responses.',
  1337|            position: 'top'
  1338|        });
  1339|
  1340|        // Add model按钮
  1341|        const addButton = document.createElement('button');
  1342|        addButton.className = 'p-button p-component p-button-sm';
  1343|        addButton.innerHTML = `<span class="p-button-icon-left pi pi-plus"></span><span class="p-button-label">${tUI('Add model')}</span>`;
  1344|        addButton.addEventListener('click', () => this._showAddModelDialog(service, modelType, modelsContainer));
  1345|
  1346|        titleRow.appendChild(title);
  1347|        titleRow.appendChild(addButton);
  1348|        section.appendChild(titleRow);
  1349|
  1350|        // 模型标签容器（可拖动排序）
  1351|        const modelsContainer = document.createElement('div');
  1352|        modelsContainer.className = 'models-container';
  1353|        modelsContainer.dataset.serviceId = service.id;
  1354|        modelsContainer.dataset.modelType = modelType;
  1355|
  1356|        const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1357|
  1358|        if (models && models.length > 0) {
  1359|            models.forEach((model) => {
  1360|                const modelTag = this._createModelTag(model, service, modelType);
  1361|                modelsContainer.appendChild(modelTag);
  1362|            });
  1363|
  1364|            // 初始化Sortable拖动排序并Save实例
  1365|            modelsContainer.sortableInstance = new Sortable(modelsContainer, {
  1366|                animation: 150,
  1367|                ghostClass: 'sortable-ghost',
  1368|                handle: '.model-tag',  // 整个标签都可以拖动
  1369|                onEnd: async (evt) => {
  1370|                    // 拖动结束后更新模型顺序
  1371|                    await this._updateModelOrder(service.id, modelType, modelsContainer);
  1372|                }
  1373|            });
  1374|        } else {
  1375|            const emptyHint = document.createElement('div');
  1376|            emptyHint.className = 'empty-hint';
  1377|            emptyHint.textContent = tUI('No models configured yet. Click "+ Add model" to get started');
  1378|            emptyHint.style.cssText = `
  1379|                font-size: 12px;
  1380|                color: var(--p-text-muted-color);
  1381|                padding: 8px;
  1382|            `;
  1383|            modelsContainer.appendChild(emptyHint);
  1384|        }
  1385|
  1386|        section.appendChild(modelsContainer);
  1387|
  1388|        // 移除固定的高级设置区域 - 现在点击模型标签时弹出气泡框编辑
  1389|
  1390|        return section;
  1391|    }
  1392|
  1393|    /**
  1394|     * Create模型标签
  1395|     */
  1396|    _createModelTag(model, service, modelType) {
  1397|        const tag = document.createElement('div');
  1398|        tag.className = `model-tag${model.is_default ? ' default' : ''}`;
  1399|        tag.dataset.modelName = model.name;
  1400|        tag.dataset.selected = 'false';
  1401|
  1402|        // 模型图标
  1403|        const iconSpan = document.createElement('i');
  1404|        iconSpan.className = 'pi pi-sparkles model-tag-icon';
  1405|        tag.appendChild(iconSpan);
  1406|
  1407|        // 模型名称
  1408|        const nameSpan = document.createElement('span');
  1409|        nameSpan.className = 'model-tag-name';
  1410|        nameSpan.textContent = model.name;
  1411|        tag.appendChild(nameSpan);
  1412|
  1413|        // Default标记
  1414|        if (model.is_default) {
  1415|            const defaultBadge = document.createElement('span');
  1416|            defaultBadge.className = 'model-tag-badge';
  1417|            defaultBadge.textContent = tUI('Default');
  1418|            tag.appendChild(defaultBadge);
  1419|        }
  1420|
  1421|        // Delete按钮
  1422|        const deleteBtn = document.createElement('button');
  1423|        deleteBtn.innerHTML = '×';
  1424|        deleteBtn.className = 'model-delete-btn';
  1425|        deleteBtn.addEventListener('click', (e) => {
  1426|            e.stopPropagation();
  1427|            this._deleteModel(service, modelType, model.name, tag);
  1428|        });
  1429|        tag.appendChild(deleteBtn);
  1430|
  1431|        // ---点击选中状态---
  1432|        tag.addEventListener('click', (e) => {
  1433|            // 如果点击的是Delete按钮,不触发选中
  1434|            if (e.target.closest('.model-delete-btn')) {
  1435|                return;
  1436|            }
  1437|            // 移除同容器内其他标签的选中状态
  1438|            const container = tag.parentElement;
  1439|            if (container) {
  1440|                container.querySelectorAll('.model-tag.selected').forEach(t => {
  1441|                    t.classList.remove('selected');
  1442|                });
  1443|            }
  1444|            // 添加当前标签的选中状态
  1445|            tag.classList.add('selected');
  1446|        });
  1447|
  1448|        // ---右键菜单---
  1449|        // 使用函数形式动态获取菜单项,确保每次显示菜单时都能获取最新的模型状态
  1450|        const getMenuItems = () => {
  1451|            // 从本地数据中获取最新的模型状态
  1452|            const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1453|            const currentModel = models.find(m => m.name === model.name);
  1454|            const isDefault = currentModel ? currentModel.is_default : false;
  1455|
  1456|            return [
  1457|                {
  1458|                    label: 'Set as default model',
  1459|                    icon: 'pi-star',
  1460|                    disabled: isDefault, // 动态获取当前是否as default model
  1461|                    onClick: () => {
  1462|                        this._setDefaultModel(service, modelType, model.name, tag);
  1463|                    }
  1464|                },
  1465|                { separator: true }, // 分隔线
  1466|                {
  1467|                    label: 'Edit model parameter settings',
  1468|                    icon: 'pi-cog',
  1469|                    onClick: () => {
  1470|                        this._selectModelForEdit(service, modelType, model.name, tag);
  1471|                    }
  1472|                }
  1473|            ];
  1474|        };
  1475|
  1476|        createContextMenu({
  1477|            target: tag,
  1478|            items: getMenuItems
  1479|        });
  1480|
  1481|        return tag;
  1482|    }
  1483|
  1484|    /**
  1485|     * 选中模型进行编辑（弹出气泡框）
  1486|     */
  1487|    _selectModelForEdit(service, modelType, modelName, tagElement) {
  1488|        // Savethis引用
  1489|        const self = this;
  1490|
  1491|        // 获取模型数据
  1492|        const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1493|        const selectedModel = models.find(m => m.name === modelName);
  1494|
  1495|        if (!selectedModel) return;
  1496|
  1497|        // 弹出气泡框编辑参数
  1498|        createConfirmPopup({
  1499|            target: tagElement,
  1500|            message: `Model parameter settings`,
  1501|            icon: 'pi-cog',
  1502|            position: 'top',
  1503|            confirmLabel: 'Save',
  1504|            cancelLabel: 'Cancel',
  1505|            renderFormContent: (formContainer) => {
  1506|                // 为表单容器添加横向布局类
  1507|                formContainer.classList.add('model-params-form');
  1508|
  1509|                // Temperature
  1510|                const tempInput = createInputGroup('Temperature', '0.0 - 2.0', 'number');
  1511|                tempInput.input.min = '0';
  1512|                tempInput.input.max = '2';
  1513|                tempInput.input.step = '0.1';
  1514|                tempInput.input.value = selectedModel.temperature ?? 0.7;
  1515|                tempInput.input.dataset.fieldName = 'temperature';
  1516|                tempInput.group.style.width = '135px';
  1517|                formContainer.appendChild(tempInput.group);
  1518|
  1519|                // Top-P
  1520|                const topPInput = createInputGroup('Top-P', '0.0 - 1.0', 'number');
  1521|                topPInput.input.min = '0';
  1522|                topPInput.input.max = '1';
  1523|                topPInput.input.step = '0.1';
  1524|                topPInput.input.value = selectedModel.top_p ?? 0.9;
  1525|                topPInput.input.dataset.fieldName = 'top_p';
  1526|                topPInput.group.style.width = '135px';
  1527|                formContainer.appendChild(topPInput.group);
  1528|
  1529|                // Max tokens
  1530|                const maxTokensInput = createInputGroup('Max tokens', '1 - 8192', 'number');
  1531|                maxTokensInput.input.min = '1';
  1532|                maxTokensInput.input.max = '8192';
  1533|                maxTokensInput.input.step = '1';
  1534|                maxTokensInput.input.value = selectedModel.max_tokens ?? 4096;
  1535|                maxTokensInput.input.dataset.fieldName = 'max_tokens';
  1536|                maxTokensInput.group.style.width = '135px';
  1537|                formContainer.appendChild(maxTokensInput.group);
  1538|            },
  1539|            onConfirm: async (formContainer) => {
  1540|                try {
  1541|                    // 获取表单数据
  1542|                    const temperature = parseFloat(formContainer.querySelector('[data-field-name="temperature"]').value);
  1543|                    const top_p = parseFloat(formContainer.querySelector('[data-field-name="top_p"]').value);
  1544|                    const max_tokens = parseInt(formContainer.querySelector('[data-field-name="max_tokens"]').value);
  1545|
  1546|                    // 验证数据
  1547|                    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
  1548|                        app.extensionManager.toast.add({
  1549|                            severity: "warn",
  1550|                            summary: "Invalid temperature value",
  1551|                            detail: "Temperature must be between 0 and 2",
  1552|                            life: 2000
  1553|                        });
  1554|                        throw new Error('Invalid temperature value');
  1555|                    }
  1556|
  1557|                    if (isNaN(top_p) || top_p < 0 || top_p > 1) {
  1558|                        app.extensionManager.toast.add({
  1559|                            severity: "warn",
  1560|                            summary: "Invalid top-p value",
  1561|                            detail: "Top-p must be between 0 and 1",
  1562|                            life: 2000
  1563|                        });
  1564|                        throw new Error('Invalid top-p value');
  1565|                    }
  1566|
  1567|                    if (isNaN(max_tokens) || max_tokens < 1 || max_tokens > 8192) {
  1568|                        app.extensionManager.toast.add({
  1569|                            severity: "warn",
  1570|                            summary: "Invalid max token count",
  1571|                            detail: "Max tokens must be between 1 and 8192",
  1572|                            life: 2000
  1573|                        });
  1574|                        throw new Error('Invalid max token count');
  1575|                    }
  1576|
  1577|                    // 使用self代替this来调用方法
  1578|                    await self._updateModelParams(service.id, modelType, modelName, {
  1579|                        temperature,
  1580|                        top_p,
  1581|                        max_tokens
  1582|                    });
  1583|
  1584|                    // 更新本地数据
  1585|                    selectedModel.temperature = temperature;
  1586|                    selectedModel.top_p = top_p;
  1587|                    selectedModel.max_tokens = max_tokens;
  1588|
  1589|                    app.extensionManager.toast.add({
  1590|                        severity: "success",
  1591|                        summary: "Parameters updated",
  1592|                        detail: `${modelName} ${tUI('parameters have been saved')}`,
  1593|                        life: 2000
  1594|                    });
  1595|                } catch (error) {
  1596|                    logger.error('更新模型参数失败', error);
  1597|                    app.extensionManager.toast.add({
  1598|                        severity: "error",
  1599|                        summary: "Update failed",
  1600|                        detail: error.message,
  1601|                        life: 3000
  1602|                    });
  1603|                    throw error;
  1604|                }
  1605|            }
  1606|        });
  1607|    }
  1608|
  1609|    /**
  1610|     * 批量更新模型参数
  1611|     */
  1612|    async _updateModelParams(serviceId, modelType, modelName, params) {
  1613|        if (!serviceId) {
  1614|            logger.error("Failed to update model parameters: serviceId is empty");
  1615|            throw new Error("Service ID cannot be empty");
  1616|        }
  1617|        try {
  1618|            // 依次更新每个参数
  1619|            for (const [paramName, paramValue] of Object.entries(params)) {
  1620|                const url = APIService.getApiUrl(`/services/${encodeURIComponent(serviceId)}/models/parameter`);
  1621|                logger.debug(`[v2] Updating parameters: ${url}`, { modelType, modelName, paramName, paramValue });
  1622|
  1623|                const res = await fetch(url, {
  1624|                    method: 'PUT',
  1625|                    headers: { 'Content-Type': 'application/json' },
  1626|                    body: JSON.stringify({
  1627|                        model_type: modelType,
  1628|                        model_name: modelName,
  1629|                        parameter_name: paramName,
  1630|                        parameter_value: paramValue
  1631|                    })
  1632|                });
  1633|
  1634|                if (!res.ok) {
  1635|                    const text = await res.text();
  1636|                    logger.error(`Parameter update request failed: ${res.status} ${res.statusText}`, text);
  1637|                    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  1638|                }
  1639|
  1640|                const text = await res.text();
  1641|                try {
  1642|                    const result = JSON.parse(text);
  1643|                    if (!result.success) {
  1644|                        throw new Error(result.error || 'Failed to update parameter');
  1645|                    }
  1646|                } catch (e) {
  1647|                    logger.error(`Failed to parse response JSON: ${text}`, e);
  1648|                    throw new Error(`Failed to parse response: ${e.message}`);
  1649|                }
  1650|            }
  1651|
  1652|            logger.debug(`Batch-updated model parameters: ${modelName}`, params);
  1653|
  1654|        } catch (error) {
  1655|            logger.error('批量更新模型参数失败', error);
  1656|            throw error;
  1657|        }
  1658|    }
  1659|
  1660|
  1661|    /**
  1662|     * 获取可用模型列表
  1663|     */
  1664|    async _getAvailableModels(service, modelType) {
  1665|        try {
  1666|            // 调用后端API获取模型列表
  1667|            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models?model_type=${modelType}`));
  1668|            const result = await res.json();
  1669|
  1670|            // 返回结果包含success、models或error
  1671|            return result;
  1672|
  1673|        } catch (error) {
  1674|            logger.error(`Failed to fetch model list: ${error.message}`);
  1675|            return {
  1676|                success: false,
  1677|                error: `Network error: ${error.message}`
  1678|            };
  1679|        }
  1680|    }
  1681|
  1682|    /**
  1683|     * 显示Add model列表框（使用多选组件）
  1684|     */
  1685|    _showAddModelDialog(service, modelType, container) {
  1686|        // 获取触发按钮
  1687|        const addBtn = event.target.closest('button');
  1688|
  1689|        // 使用新的多选listbox组件
  1690|        createMultiSelectListbox({
  1691|            triggerElement: addBtn,
  1692|            placeholder: `${tUI('Search')}${modelType === 'llm' ? 'LLM' : 'VLM'}${tUI(' models...')}`,
  1693|            fetchItems: async () => {
  1694|                const result = await this._getAvailableModels(service, modelType);
  1695|
  1696|                if (!result.success) {
  1697|                    throw new Error(result.error || 'Failed to fetch model list');
  1698|                }
  1699|
  1700|                return result.models[modelType] || [];
  1701|            },
  1702|            onConfirm: async (selectedModels, searchInputValue) => {
  1703|                // 如果没有勾选模型,但Search框有内容,则将Search框内容作为模型名称添加
  1704|                if (selectedModels.length === 0 && searchInputValue && searchInputValue.trim()) {
  1705|                    const modelName = searchInputValue.trim();
  1706|                    await this._addModel(service, modelType, modelName, container);
  1707|                } else {
  1708|                    // 批量添加选中的模型
  1709|                    for (const modelName of selectedModels) {
  1710|                        await this._addModel(service, modelType, modelName, container);
  1711|                    }
  1712|                }
  1713|            }
  1714|        });
  1715|    }
  1716|
  1717|    /**
  1718|     * 获取推荐模型列表（已移除，返回空数组）
  1719|     */
  1720|    async _getRecommendedModels(modelType) {
  1721|        // 推荐模型已移除，所有模型从ProviderAPI获取
  1722|        return [];
  1723|    }
  1724|
  1725|    /**
  1726|     * Add model
  1727|     */
  1728|    async _addModel(service, modelType, modelName, container) {
  1729|        try {
  1730|            // 调用后端APIAdd model
  1731|            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models`), {
  1732|                method: 'POST',
  1733|                headers: { 'Content-Type': 'application/json' },
  1734|                body: JSON.stringify({
  1735|                    model_type: modelType,
  1736|                    model_name: modelName,
  1737|                    temperature: 0.7,
  1738|                    top_p: 0.9,
  1739|                    max_tokens: 4096
  1740|                })
  1741|            });
  1742|
  1743|            const result = await res.json();
  1744|
  1745|            if (!result.success) {
  1746|                throw new Error(result.error || 'Failed to add model');
  1747|            }
  1748|
  1749|            // 更新本地数据
  1750|            const modelList = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1751|            if (!modelList) {
  1752|                if (modelType === 'llm') {
  1753|                    service.llm_models = [];
  1754|                } else {
  1755|                    service.vlm_models = [];
  1756|                }
  1757|            }
  1758|
  1759|            const updatedList = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1760|            updatedList.push({
  1761|                name: modelName,
  1762|                is_default: updatedList.length === 0,
  1763|                temperature: 0.7,
  1764|                top_p: 0.9,
  1765|                max_tokens: 4096
  1766|            });
  1767|
  1768|            // 移除空提示
  1769|            const emptyHint = container.querySelector('.empty-hint');
  1770|            if (emptyHint) {
  1771|                emptyHint.remove();
  1772|            }
  1773|
  1774|            // 添加新标签
  1775|            const newTag = this._createModelTag({
  1776|                name: modelName,
  1777|                is_default: updatedList.length === 1
  1778|            }, service, modelType);
  1779|            container.appendChild(newTag);
  1780|
  1781|            // 初始化或更新Sortable（确保新添加的标签可以拖动）
  1782|            // 先销毁旧的Sortable实例（如果存在）
  1783|            if (container.sortableInstance) {
  1784|                container.sortableInstance.destroy();
  1785|            }
  1786|
  1787|            // Create新的Sortable实例
  1788|            container.sortableInstance = new Sortable(container, {
  1789|                animation: 150,
  1790|                ghostClass: 'sortable-ghost',
  1791|                handle: '.model-tag',
  1792|                onEnd: async (evt) => {
  1793|                    await this._updateModelOrder(service.id, modelType, container);
  1794|                }
  1795|            });
  1796|
  1797|            app.extensionManager.toast.add({
  1798|                severity: "success",
  1799|                summary: "Model added",
  1800|                life: 2000
  1801|            });
  1802|
  1803|        } catch (error) {
  1804|            logger.error('Failed to add model', error);
  1805|            app.extensionManager.toast.add({
  1806|                severity: "error",
  1807|                summary: "Failed to add",
  1808|                detail: error.message,
  1809|                life: 3000
  1810|            });
  1811|        }
  1812|    }
  1813|
  1814|    /**
  1815|     * Delete模型
  1816|     */
  1817|    async _deleteModel(service, modelType, modelName, tagElement) {
  1818|        // 使用createSettingsDialogCreate确认窗口
  1819|        createSettingsDialog({
  1820|            title: `<i class="pi pi-exclamation-triangle" style="margin-right: 8px; color: var(--p-orange-500);"></i>${tUI('Confirm delete')}`,
  1821|            isConfirmDialog: true,
  1822|            dialogClassName: 'confirm-dialog',
  1823|            saveButtonText: tUI('Delete'),
  1824|            saveButtonIcon: 'pi-trash',
  1825|            isDangerButton: true,
  1826|            cancelButtonText: tUI('Cancel'),
  1827|            renderContent: (content) => {
  1828|                content.className = 'confirm-dialog-content-simple';
  1829|
  1830|                const confirmMessage = document.createElement('p');
  1831|                confirmMessage.className = 'confirm-dialog-message-simple';
  1832|                confirmMessage.textContent = `${tUI('Are you sure you want to delete model')} "${modelName}" ${tUI('?')}`;
  1833|
  1834|                content.appendChild(confirmMessage);
  1835|            },
  1836|            onSave: async () => {
  1837|                try {
  1838|                    // 调用后端APIDelete模型
  1839|                    const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models/${modelType}/${encodeURIComponent(modelName)}`), {
  1840|                        method: 'DELETE'
  1841|                    });
  1842|
  1843|                    const result = await res.json();
  1844|
  1845|                    if (!result.success) {
  1846|                        throw new Error(result.error || 'Failed to delete model');
  1847|                    }
  1848|
  1849|                    // 更新本地数据
  1850|                    const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1851|                    const index = models.findIndex(m => m.name === modelName);
  1852|                    if (index >= 0) {
  1853|                        models.splice(index, 1);
  1854|                    }
  1855|
  1856|                    // 移除标签
  1857|                    tagElement.remove();
  1858|
  1859|                    // 如果Delete后为空，显示空提示
  1860|                    const container = tagElement.parentElement;
  1861|                    if (container && container.children.length === 0) {
  1862|                        const emptyHint = document.createElement('div');
  1863|                        emptyHint.className = 'empty-hint';
  1864|                        emptyHint.textContent = tUI('No models configured yet. Click "+ Add model" to get started');
  1865|                        emptyHint.style.cssText = `
  1866|                            font-size: 12px;
  1867|                            color: var(--p-text-muted-color);
  1868|                            padding: 8px;
  1869|                        `;
  1870|                        container.appendChild(emptyHint);
  1871|                    }
  1872|
  1873|                    app.extensionManager.toast.add({
  1874|                        severity: "success",
  1875|                        summary: "Model deleted",
  1876|                        life: 2000
  1877|                    });
  1878|
  1879|                    return true; // 允许关闭对话框
  1880|
  1881|                } catch (error) {
  1882|                    logger.error('Failed to delete model', error);
  1883|                    app.extensionManager.toast.add({
  1884|                        severity: "error",
  1885|                        summary: "Delete failed",
  1886|                        detail: error.message,
  1887|                        life: 3000
  1888|                    });
  1889|                    return false; // 阻止关闭对话框
  1890|                }
  1891|            }
  1892|        });
  1893|    }
  1894|
  1895|    /**
  1896|     * 设置Default模型
  1897|     */
  1898|    async _setDefaultModel(service, modelType, modelName, tagElement) {
  1899|        try {
  1900|            // 调用后端API设置Default模型
  1901|            const res = await fetch(APIService.getApiUrl(`/services/${service.id}/models/default`), {
  1902|                method: 'PUT',
  1903|                headers: { 'Content-Type': 'application/json' },
  1904|                body: JSON.stringify({
  1905|                    model_type: modelType,
  1906|                    model_name: modelName
  1907|                })
  1908|            });
  1909|
  1910|            const result = await res.json();
  1911|
  1912|            if (!result.success) {
  1913|                throw new Error(result.error || 'Failed to set default model');
  1914|            }
  1915|
  1916|            // 更新本地数据
  1917|            const models = modelType === 'llm' ? service.llm_models : service.vlm_models;
  1918|            models.forEach(m => {
  1919|                m.is_default = m.name === modelName;
  1920|            });
  1921|
  1922|            // ---直接更新DOM，无需重新加载---
  1923|            const container = tagElement?.parentElement;
  1924|            if (container) {
  1925|                // 移除所有标签的Default状态
  1926|                container.querySelectorAll('.model-tag').forEach(tag => {
  1927|                    tag.classList.remove('default');
  1928|                    // 移除旧的Default标记
  1929|                    const oldBadge = tag.querySelector('.model-tag-badge');
  1930|                    if (oldBadge) {
  1931|                        oldBadge.remove();
  1932|                    }
  1933|                });
  1934|
  1935|                // 为新的Default模型添加样式和标记
  1936|                if (tagElement) {
  1937|                    tagElement.classList.add('default');
  1938|                    // 在名称后面添加Default标记
  1939|                    const nameSpan = tagElement.querySelector('.model-tag-name');
  1940|                    if (nameSpan) {
  1941|                        const defaultBadge = document.createElement('span');
  1942|                        defaultBadge.className = 'model-tag-badge';
  1943|                        defaultBadge.textContent = tUI('Default');
  1944|                        nameSpan.after(defaultBadge);
  1945|                    }
  1946|                }
  1947|            }
  1948|
  1949|            app.extensionManager.toast.add({
  1950|                severity: "success",
  1951|                summary: `${tUI('Set')} "${modelName}" ${tUI('as default model')}`,
  1952|                life: 2000
  1953|            });
  1954|
  1955|        } catch (error) {
  1956|            logger.error('Failed to set default model', error);
  1957|            app.extensionManager.toast.add({
  1958|                severity: "error",
  1959|                summary: "Set failed",
  1960|                detail: error.message,
  1961|                life: 3000
  1962|            });
  1963|        }
  1964|    }
  1965|
  1966|    /**
  1967|     * 更新模型顺序
  1968|     */
  1969|    async _updateModelOrder(serviceId, modelType, container) {
  1970|        try {
  1971|            const modelTags = container.querySelectorAll('.model-tag');
  1972|            const newOrder = Array.from(modelTags).map(tag => tag.dataset.modelName);
  1973|
  1974|            // 调用后端API更新顺序
  1975|            const res = await fetch(APIService.getApiUrl(`/services/${serviceId}/models/order`), {
  1976|                method: 'PUT',
  1977|                headers: { 'Content-Type': 'application/json' },
  1978|                body: JSON.stringify({
  1979|                    model_type: modelType,
  1980|                    model_names: newOrder
  1981|                })
  1982|            });
  1983|
  1984|            const result = await res.json();
  1985|
  1986|            if (!result.success) {
  1987|                throw new Error(result.error || 'Failed to update model order');
  1988|            }
  1989|
  1990|            app.extensionManager.toast.add({
  1991|                severity: "success",
  1992|                summary: "Model order updated",
  1993|                life: 2000
  1994|            });
  1995|
  1996|        } catch (error) {
  1997|            logger.error('Failed to update model order', error);
  1998|            app.extensionManager.toast.add({
  1999|                severity: "error",
  2000|                summary: "Update failed",
  2001|