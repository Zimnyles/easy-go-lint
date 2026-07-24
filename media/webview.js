(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const remembered = vscode.getState() || {};
  let dashboard = remembered.dashboard || {
    workspaceName: '',
    profiles: [],
    activeProfile: '',
    showResultsInOutput: true,
    showResultsInDashboard: false
  };
  let selectedFile = remembered.selectedFile || '';
  let report = remembered.report || null;
  let lintStatus = null;
  let screen = 'main';
  let editorStep = 1;
  let currentProfile = null;
  let editingFile = null;
  let catalog = { linters: [], formatters: [] };
  let yamlValid = false;
  let validationRequest = 0;
  let latestValidation = 0;
  let validationTimer;
  const translations = {
    ru: {
      saveFailed: 'Не удалось сохранить профиль.',
      active: 'Активный',
      project: 'Проект',
      global: 'Глобальный',
      lintersCount: 'линтеров',
      formattersCount: 'форматтеров',
      noProfiles: 'Профилей пока нет',
      noProfilesText: 'Создайте профиль или импортируйте файл *.golangci.yml.',
      create: 'Создать профиль',
      openWorkspace: 'Откройте workspace',
      language: 'Язык интерфейса',
      activeProfile: 'Активный профиль',
      notSelected: 'Не выбран',
      profilesHint: 'Используются профили *.golangci.yml',
      destinations: 'Куда выводить результат Lint',
      destinationsHint: 'Можно включить один или оба варианта.',
      output: 'Нижняя панель Output',
      dashboard: 'Окно Easy Go Lint',
      lintProject: 'Проверить весь проект',
      import: 'Импортировать .golangci.yml',
      edit: 'Редактировать',
      export: 'Экспортировать',
      activate: 'Сделать активным',
      delete: 'Удалить',
      editProfile: 'Редактирование golangci-lint профиля',
      newProfile: 'Новый golangci-lint профиль',
      formatHelp: 'Формат конфигурации: version: "2", файл *.golangci.yml.',
      close: 'Закрыть',
      stepProfile: '1. Профиль',
      stepLinters: '2. Линтеры',
      stepSettings: '3. Настройки',
      back: 'Назад',
      editYaml: 'Редактировать YAML',
      cancel: 'Отмена',
      next: 'Далее',
      save: 'Сохранить',
      basic: 'Основная информация',
      name: 'Название *',
      description: 'Описание',
      baseSet: 'Базовый набор',
      noneOnly: 'none — только выбранные',
      testFiles: 'Тестовые файлы',
      checkTests: 'Проверять *_test.go',
      fileName: 'Имя файла',
      linters: 'Линтеры',
      findLinter: 'Найти линтер…',
      formatters: 'Форматтеры',
      settings: 'Основные настройки',
      declarationOrder: 'decorder: порядок деклараций',
      linterExclusions: 'Исключения линтеров',
      formatterExclusions: 'Исключения форматтеров',
      yamlEditor: 'Редактор .golangci.yml',
      yamlCheck: 'Проверка выполняется встроенным golangci-lint config verify.',
      checking: 'Проверка конфигурации…',
      backToForm: 'Вернуться к форме',
      valid: 'Корректный профиль golangci-lint v2.',
      selected: 'выбрано',
      error: 'Ошибка',
      warningShort: 'Предупр.',
      information: 'Информация',
      line: 'Строка',
      column: 'колонка',
      report: 'Отчёт',
      reset: 'Сбросить',
      resetTitle: 'Убрать отчёт и подчёркивания Easy Go Lint',
      profile: 'Профиль',
      milliseconds: 'мс',
      errors: 'Ошибки',
      warnings: 'Предупреждения',
      noProblems: 'Проблем не найдено.',
      notCompleted: 'Проверка не завершена',
      lintFailed: 'golangci-lint завершился с ошибкой.',
      result: 'Результат',
      running: 'Проверка запущена и сейчас выполняется. Пожалуйста, подождите.',
      coldTitle: 'Первый запуск — кэш ещё не прогрет.',
      coldText: 'Проверка может занять больше времени. Последующие запуски будут значительно быстрее.',
      warmTitle: 'Кэш прогрет.',
      warmText: 'Повторная проверка обычно завершается быстро.'
    },
    en: {
      saveFailed: 'Failed to save the profile.',
      active: 'Active',
      project: 'Project',
      global: 'Global',
      lintersCount: 'linters',
      formattersCount: 'formatters',
      noProfiles: 'No profiles yet',
      noProfilesText: 'Create a profile or import a *.golangci.yml file.',
      create: 'Create profile',
      openWorkspace: 'Open a workspace',
      language: 'Interface language',
      activeProfile: 'Active profile',
      notSelected: 'Not selected',
      profilesHint: '*.golangci.yml profiles are used',
      destinations: 'Where to show Lint results',
      destinationsHint: 'You can enable either or both destinations.',
      output: 'Output panel',
      dashboard: 'Easy Go Lint window',
      lintProject: 'Lint entire project',
      import: 'Import .golangci.yml',
      edit: 'Edit',
      export: 'Export',
      activate: 'Make active',
      delete: 'Delete',
      editProfile: 'Edit golangci-lint profile',
      newProfile: 'New golangci-lint profile',
      formatHelp: 'Configuration format: version: "2", file *.golangci.yml.',
      close: 'Close',
      stepProfile: '1. Profile',
      stepLinters: '2. Linters',
      stepSettings: '3. Settings',
      back: 'Back',
      editYaml: 'Edit YAML',
      cancel: 'Cancel',
      next: 'Next',
      save: 'Save',
      basic: 'Basic information',
      name: 'Name *',
      description: 'Description',
      baseSet: 'Default set',
      noneOnly: 'none — selected only',
      testFiles: 'Test files',
      checkTests: 'Check *_test.go',
      fileName: 'File name',
      linters: 'Linters',
      findLinter: 'Find a linter…',
      formatters: 'Formatters',
      settings: 'Main settings',
      declarationOrder: 'decorder: declaration order',
      linterExclusions: 'Linter exclusions',
      formatterExclusions: 'Formatter exclusions',
      yamlEditor: '.golangci.yml editor',
      yamlCheck: 'Validation uses the bundled golangci-lint config verify.',
      checking: 'Validating configuration…',
      backToForm: 'Back to form',
      valid: 'Valid golangci-lint v2 profile.',
      selected: 'selected',
      error: 'Error',
      warningShort: 'Warning',
      information: 'Information',
      line: 'Line',
      column: 'column',
      report: 'Report',
      reset: 'Reset',
      resetTitle: 'Clear the report and Easy Go Lint diagnostics',
      profile: 'Profile',
      milliseconds: 'ms',
      errors: 'Errors',
      warnings: 'Warnings',
      noProblems: 'No problems found.',
      notCompleted: 'Check did not complete',
      lintFailed: 'golangci-lint finished with an error.',
      result: 'Result',
      running: 'The check is running. Please wait.',
      coldTitle: 'First run — the cache is still cold.',
      coldText: 'This check may take longer. Subsequent runs will be much faster.',
      warmTitle: 'Cache is warm.',
      warmText: 'A repeated check should finish quickly.'
    }
  };

  function tr(key) {
    const language = dashboard.language === 'en' ? 'en' : 'ru';
    return translations[language][key] || translations.ru[key] || key;
  }

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (message.type === 'state') {
      dashboard = message.state;
      document.documentElement.lang = dashboard.language === 'en' ? 'en' : 'ru';
      report = message.report;
      lintStatus = message.lintStatus;
      if (!dashboard.profiles.some(function (item) {
        return item.id === selectedFile;
      })) {
        selectedFile = dashboard.activeProfile || dashboard.profiles[0]?.id || '';
      }
      screen = 'main';
      persist();
      render();
    } else if (message.type === 'editProfile') {
      currentProfile = deepClone(message.profile);
      editingFile = message.fileName;
      catalog = message.catalog || catalog;
      editorStep = 1;
      screen = 'form';
      render();
    } else if (message.type === 'editYaml') {
      editingFile = message.fileName;
      screen = 'yaml';
      renderYamlEditor(message.yaml || '');
    } else if (message.type === 'validationResult') {
      if (message.requestId >= latestValidation) {
        latestValidation = message.requestId;
        showYamlValidation(message.errors || []);
      }
    } else if (message.type === 'saveError') {
      showInlineErrors(message.errors || [tr('saveFailed')]);
    } else if (message.type === 'report') {
      report = message.report;
      lintStatus = null;
      screen = 'main';
      persist();
      render();
      document.getElementById('report')?.scrollIntoView({ behavior: 'smooth' });
    } else if (message.type === 'lintStatus') {
      lintStatus = message.status || null;
      screen = 'main';
      persist();
      render();
      document.getElementById('report')?.scrollIntoView({ behavior: 'smooth' });
    } else if (message.type === 'clearReport') {
      report = null;
      lintStatus = null;
      screen = 'main';
      persist();
      render();
    }
  });

  app.addEventListener('click', function (event) {
    const target = event.target.closest('[data-action]');
    if (!target) {
      const card = event.target.closest('[data-profile]');
      if (card) {
        selectedFile = card.dataset.profile;
        persist();
        render();
      }
      return;
    }
    const action = target.dataset.action;
    if (action === 'create') {
      vscode.postMessage({ type: 'create' });
    } else if (action === 'import') {
      vscode.postMessage({ type: 'import' });
    } else if (action === 'edit' && selectedFile) {
      vscode.postMessage({ type: 'edit', profileId: selectedFile });
    } else if (action === 'export' && selectedFile) {
      vscode.postMessage({ type: 'export', profileId: selectedFile });
    } else if (action === 'delete' && selectedFile) {
      vscode.postMessage({ type: 'delete', profileId: selectedFile });
    } else if (action === 'activate' && selectedFile) {
      dashboard.activeProfile = selectedFile;
      persist();
      render();
      vscode.postMessage({ type: 'activate', profileId: selectedFile });
    } else if (action === 'lint') {
      vscode.postMessage({ type: 'lint' });
    } else if (action === 'lintWorkspace') {
      vscode.postMessage({ type: 'lintWorkspace' });
    } else if (action === 'fix') {
      vscode.postMessage({ type: 'fix' });
    } else if (action === 'language') {
      const language = target.dataset.language;
      if (language === 'ru' || language === 'en') {
        dashboard.language = language;
        document.documentElement.lang = language;
        persist();
        render();
        vscode.postMessage({ type: 'updateLanguage', language: language });
      }
    } else if (action === 'resetReport') {
      vscode.postMessage({ type: 'resetReport' });
    } else if (action === 'step') {
      syncForm();
      editorStep = Number(target.dataset.step);
      render();
    } else if (action === 'next') {
      syncForm();
      editorStep = Math.min(3, editorStep + 1);
      render();
    } else if (action === 'back') {
      syncForm();
      editorStep = Math.max(1, editorStep - 1);
      render();
    } else if (action === 'cancelEditor') {
      screen = 'main';
      currentProfile = null;
      editingFile = null;
      render();
    } else if (action === 'manual') {
      syncForm();
      vscode.postMessage({
        type: 'profileToYaml',
        profile: currentProfile,
        fileName: editingFile
      });
    } else if (action === 'backToForm') {
      const editor = document.getElementById('yaml-editor');
      if (editor) {
        vscode.postMessage({
          type: 'yamlToForm',
          yaml: editor.value,
          fileName: editingFile
        });
      }
    } else if (action === 'saveForm') {
      syncForm();
      vscode.postMessage({
        type: 'saveProfile',
        profile: currentProfile,
        fileName: editingFile
      });
    } else if (action === 'saveYaml') {
      const editor = document.getElementById('yaml-editor');
      if (editor && yamlValid) {
        vscode.postMessage({
          type: 'saveYaml',
          yaml: editor.value,
          fileName: editingFile
        });
      }
    } else if (action === 'openProblem') {
      vscode.postMessage({
        type: 'openProblem',
        uri: target.dataset.uri,
        line: Number(target.dataset.line),
        column: Number(target.dataset.column)
      });
    }
  });

  app.addEventListener('input', function (event) {
    if (event.target.id === 'yaml-editor') {
      syncYamlScroll();
      refreshYamlHighlight();
      scheduleYamlValidation();
    } else if (event.target.id === 'linter-search') {
      filterLinters(event.target.value);
    } else if (screen === 'form') {
      syncForm();
      updateSelectionCount();
      const preview = document.getElementById('file-preview');
      if (preview) {
        preview.textContent = displayFileName(editingFile) ||
          slugFile(currentProfile.name);
      }
    }
  });

  app.addEventListener('change', function (event) {
    if (!event.target.matches('[data-result-destination]')) {
      return;
    }
    const output = document.getElementById('results-output');
    const dashboardOutput = document.getElementById('results-dashboard');
    dashboard.showResultsInOutput = output?.checked === true;
    dashboard.showResultsInDashboard = dashboardOutput?.checked === true;
    persist();
    vscode.postMessage({
      type: 'updateResultDestinations',
      output: dashboard.showResultsInOutput,
      dashboard: dashboard.showResultsInDashboard
    });
  });

  app.addEventListener('scroll', function (event) {
    if (event.target.id === 'yaml-editor') {
      syncYamlScroll();
    }
  }, true);

  function render() {
    if (screen === 'form') {
      renderForm();
    } else if (screen === 'main') {
      renderMain();
    }
  }

  function renderMain() {
    const selected = dashboard.profiles.find(function (item) {
      return item.id === selectedFile;
    });
    const active = dashboard.profiles.find(function (item) {
      return item.id === dashboard.activeProfile;
    });
    const disabled = selected ? '' : ' disabled';
    const editDisabled = !selected || selected.readOnly ? ' disabled' : '';
    const deleteDisabled = !selected || selected.readOnly ? ' disabled' : '';
    const isActive = selected?.id === dashboard.activeProfile;
    let cards = dashboard.profiles.map(function (profile) {
      return '<article class="profile-card ' +
        (profile.id === selectedFile ? 'selected' : '') +
        '" data-profile="' + escapeAttribute(profile.id) + '">' +
        '<div class="profile-head"><h3>' + escapeHtml(profile.name) + '</h3>' +
        '<div class="profile-badges">' +
        (profile.id === dashboard.activeProfile ? '<span class="badge">' + tr('active') + '</span>' : '') +
        '<span class="scope-badge ' + profile.scope + '">' +
        (profile.scope === 'workspace' ? tr('project') : tr('global')) +
        '</span></div>' +
        '</div><p>' + escapeHtml(profile.description || 'golangci-lint v2') + '</p>' +
        '<span class="profile-file">' + escapeHtml(profile.fileName) + '</span>' +
        '<span class="rule-count">' + profile.enabledLinters.length +
        ' ' + tr('lintersCount') + ' · ' + profile.enabledFormatters.length + ' ' +
        tr('formattersCount') + '</span></article>';
    }).join('');
    if (!cards) {
      cards = '<section class="empty-state"><h2>' + tr('noProfiles') + '</h2>' +
        '<p>' + tr('noProfilesText') + '</p>' +
        '<button data-action="create">' + tr('create') + '</button></section>';
    }
    app.innerHTML = '<div class="shell"><header class="topbar"><div class="brand">' +
      '<h1>Easy Go Lint</h1><p>' + escapeHtml(dashboard.workspaceName || tr('openWorkspace')) +
      '</p></div><div class="actions language-actions" role="group" aria-label="' +
      tr('language') + '"><button class="ghost' +
      (dashboard.language !== 'en' ? ' active' : '') +
      '" data-action="language" data-language="ru">RU</button>' +
      '<button class="ghost' + (dashboard.language === 'en' ? ' active' : '') +
      '" data-action="language" data-language="en">EN</button></div></header>' +
      '<section class="active-banner"><div><strong>' + tr('activeProfile') + '</strong><span>' +
      escapeHtml(active ? active.name : tr('notSelected')) + '</span></div><span>' +
      escapeHtml(active ? active.fileName : tr('profilesHint')) +
      '</span></section><section class="result-destinations"><div><strong>' + tr('destinations') + '</strong>' +
      '<span>' + tr('destinationsHint') + '</span></div><label class="destination-option">' +
      '<label class="switch"><input id="results-output" data-result-destination type="checkbox"' +
      (dashboard.showResultsInOutput ? ' checked' : '') + '><span></span></label>' +
      '<span>' + tr('output') + '</span></label><label class="destination-option">' +
      '<label class="switch"><input id="results-dashboard" data-result-destination type="checkbox"' +
      (dashboard.showResultsInDashboard ? ' checked' : '') + '><span></span></label>' +
      '<span>' + tr('dashboard') + '</span></label></section>' +
      '<nav class="toolbar"><button data-action="lintWorkspace"' +
      (lintStatus?.phase === 'running' ? ' disabled' : '') + '>' + tr('lintProject') + '</button>' +
      '<button class="secondary" data-action="create">' + tr('create') + '</button>' +
      '<button class="secondary" data-action="import">' + tr('import') + '</button>' +
      '<button class="ghost" data-action="edit"' + editDisabled + '>' + tr('edit') + '</button>' +
      '<button class="ghost" data-action="export"' + disabled + '>' + tr('export') + '</button>' +
      '<button class="ghost" data-action="activate"' + (disabled || isActive ? ' disabled' : '') +
      '>' + tr('activate') + '</button><button class="danger" data-action="delete"' + deleteDisabled +
      '>' + tr('delete') + '</button></nav><section class="profile-grid">' + cards + '</section>' +
      renderLintStatus(lintStatus) +
      (!lintStatus && dashboard.showResultsInDashboard ? renderReport(report) : '') + '</div>';
  }

  function renderForm() {
    if (!currentProfile) {
      screen = 'main';
      renderMain();
      return;
    }
    ensureConfig();
    let content;
    if (editorStep === 1) {
      content = renderBasics();
    } else if (editorStep === 2) {
      content = renderLinters();
    } else {
      content = renderFormattersAndSettings();
    }
    app.innerHTML = '<div class="shell"><header class="editor-head"><div><h1>' +
      (editingFile ? tr('editProfile') : tr('newProfile')) +
      '</h1><p>' + tr('formatHelp') + '</p></div>' +
      '<button class="ghost" data-action="cancelEditor">' + tr('close') + '</button></header>' +
      '<nav class="steps">' + stepButton(1, tr('stepProfile')) +
      stepButton(2, tr('stepLinters')) + stepButton(3, tr('stepSettings')) +
      '</nav>' + content + '<div id="inline-errors"></div>' +
      '<footer class="step-actions"><div class="actions">' +
      (editorStep > 1 ? '<button class="secondary" data-action="back">' + tr('back') + '</button>' : '') +
      '<button class="ghost" data-action="manual">' + tr('editYaml') + '</button></div>' +
      '<div class="actions"><button class="ghost" data-action="cancelEditor">' + tr('cancel') + '</button>' +
      (editorStep < 3
        ? '<button data-action="next">' + tr('next') + '</button>'
        : '<button data-action="saveForm">' + tr('save') + '</button>') +
      '</div></footer></div>';
    updateSelectionCount();
  }

  function renderBasics() {
    const tests = currentProfile.config.run?.tests === true;
    const defaultSet = currentProfile.config.linters?.default || 'none';
    return '<section class="form-card"><h2>' + tr('basic') + '</h2>' +
      '<div class="field-grid"><div class="field full"><label for="profile-name">' + tr('name') + '</label>' +
      '<input id="profile-name" type="text" maxlength="120" value="' +
      escapeAttribute(currentProfile.name || '') + '"></div>' +
      '<div class="field full"><label for="profile-description">' + tr('description') + '</label>' +
      '<textarea id="profile-description" maxlength="2000">' +
      escapeHtml(currentProfile.description || '') + '</textarea></div>' +
      '<div class="field"><label for="default-set">' + tr('baseSet') + '</label><select id="default-set">' +
      option('none', tr('noneOnly'), defaultSet) +
      option('standard', 'standard', defaultSet) +
      option('all', 'all', defaultSet) + '</select></div>' +
      '<div class="field"><span class="field-label">' + tr('testFiles') + '</span>' +
      '<label class="rule-title"><label class="switch"><input id="run-tests" type="checkbox"' +
      (tests ? ' checked' : '') + '><span></span></label><span>' + tr('checkTests') + '</span></label></div>' +
      '<div class="field full"><span class="field-label">' + tr('fileName') + '</span>' +
      '<code class="file-preview" id="file-preview">' +
      escapeHtml(displayFileName(editingFile) || slugFile(currentProfile.name)) +
      '</code></div></div></section>';
  }

  function renderLinters() {
    const enabled = new Set(currentProfile.config.linters?.enable || []);
    const items = catalog.linters.map(function (item) {
      const flags = [
        item.fast ? 'fast' : '',
        item.autoFix ? 'auto-fix' : '',
        item.deprecated ? 'deprecated' : ''
      ].filter(Boolean).join(' · ');
      return '<label class="catalog-item" data-catalog-name="' +
        escapeAttribute((item.name + ' ' + item.description).toLowerCase()) + '">' +
        '<input type="checkbox" data-linter="' + escapeAttribute(item.name) + '"' +
        (enabled.has(item.name) ? ' checked' : '') + '><span><strong>' +
        escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.description) +
        '</small>' + (flags ? '<em>' + escapeHtml(flags) + '</em>' : '') +
        '</span></label>';
    }).join('');
    return '<section class="form-card"><div class="profile-head"><h2>' + tr('linters') + '</h2>' +
      '<span id="selection-count" class="rule-count"></span></div>' +
      '<div class="field full"><input id="linter-search" type="text" placeholder="' + tr('findLinter') + '"></div>' +
      '<div class="catalog-grid">' + items + '</div></section>';
  }

  function renderFormattersAndSettings() {
    const enabled = new Set(currentProfile.config.formatters?.enable || []);
    const formatters = catalog.formatters.map(function (item) {
      return '<label class="catalog-item compact"><input type="checkbox" data-formatter="' +
        escapeAttribute(item.name) + '"' + (enabled.has(item.name) ? ' checked' : '') +
        '><span><strong>' + escapeHtml(item.name) + '</strong><small>' +
        escapeHtml(item.description) + '</small></span></label>';
    }).join('');
    const cyclop = readNested(currentProfile.config, ['linters', 'settings', 'cyclop', 'max-complexity'], 20);
    const lineLength = readNested(currentProfile.config, ['linters', 'settings', 'lll', 'line-length'], 150);
    const order = readNested(currentProfile.config, ['linters', 'settings', 'decorder', 'dec-order'], ['const', 'var', 'type', 'func']);
    const linterPaths = readNested(currentProfile.config, ['linters', 'exclusions', 'paths'], []);
    const formatterPaths = readNested(currentProfile.config, ['formatters', 'exclusions', 'paths'], []);
    return '<section class="form-card"><h2>' + tr('formatters') + '</h2><div class="catalog-grid formatters">' +
      formatters + '</div><h2 class="settings-title">' + tr('settings') + '</h2>' +
      '<div class="field-grid"><div class="field"><label for="cyclop-max">cyclop: max-complexity</label>' +
      '<input id="cyclop-max" type="number" min="1" max="1000" value="' +
      escapeAttribute(cyclop) + '"></div><div class="field"><label for="lll-length">lll: line-length</label>' +
      '<input id="lll-length" type="number" min="1" max="10000" value="' +
      escapeAttribute(lineLength) + '"></div>' +
      '<div class="field full"><label for="dec-order">' + tr('declarationOrder') + '</label>' +
      '<input id="dec-order" type="text" value="' +
      escapeAttribute(Array.isArray(order) ? order.join(', ') : '') + '"></div>' +
      '<div class="field"><label for="linter-paths">' + tr('linterExclusions') + '</label><textarea id="linter-paths">' +
      escapeHtml(Array.isArray(linterPaths) ? linterPaths.join('\n') : '') + '</textarea></div>' +
      '<div class="field"><label for="formatter-paths">' + tr('formatterExclusions') + '</label><textarea id="formatter-paths">' +
      escapeHtml(Array.isArray(formatterPaths) ? formatterPaths.join('\n') : '') +
      '</textarea></div></div></section>';
  }

  function renderYamlEditor(yaml) {
    app.innerHTML = '<div class="shell"><header class="editor-head"><div><h1>' + tr('yamlEditor') + '</h1>' +
      '<p>' + tr('yamlCheck') + '</p></div></header>' +
      '<section class="json-layout"><div class="json-editor-wrap">' +
      '<pre id="yaml-highlight" aria-hidden="true"></pre>' +
      '<textarea id="yaml-editor" spellcheck="false" aria-label="YAML профиля">' +
      escapeHtml(yaml) + '</textarea></div>' +
      '<div id="yaml-validation" class="validation">' + tr('checking') + '</div>' +
      '<div class="step-actions"><button class="secondary" data-action="backToForm">' + tr('backToForm') + '</button>' +
      '<div class="actions"><button class="ghost" data-action="cancelEditor">' + tr('cancel') + '</button>' +
      '<button id="save-yaml" data-action="saveYaml" disabled>' + tr('save') + '</button>' +
      '</div></div></section></div>';
    refreshYamlHighlight();
    scheduleYamlValidation();
  }

  function syncForm() {
    if (!currentProfile || screen !== 'form') {
      return;
    }
    ensureConfig();
    const name = document.getElementById('profile-name');
    const description = document.getElementById('profile-description');
    const tests = document.getElementById('run-tests');
    const defaultSet = document.getElementById('default-set');
    if (name) currentProfile.name = name.value;
    if (description) currentProfile.description = description.value;
    if (tests) currentProfile.config.run.tests = tests.checked;
    if (defaultSet) currentProfile.config.linters.default = defaultSet.value;
    const linterInputs = document.querySelectorAll('[data-linter]');
    if (linterInputs.length) {
      currentProfile.config.linters.enable = Array.from(linterInputs)
        .filter(function (input) { return input.checked; })
        .map(function (input) { return input.dataset.linter; })
        .sort();
    }
    const formatterInputs = document.querySelectorAll('[data-formatter]');
    if (formatterInputs.length) {
      currentProfile.config.formatters.enable = Array.from(formatterInputs)
        .filter(function (input) { return input.checked; })
        .map(function (input) { return input.dataset.formatter; })
        .sort();
    }
    setNumber('cyclop-max', ['linters', 'settings', 'cyclop', 'max-complexity']);
    setNumber('lll-length', ['linters', 'settings', 'lll', 'line-length']);
    const order = document.getElementById('dec-order');
    if (order) {
      writeNested(currentProfile.config, ['linters', 'settings', 'decorder', 'dec-order'],
        order.value.split(',').map(function (item) { return item.trim(); }).filter(Boolean));
    }
    setLines('linter-paths', ['linters', 'exclusions', 'paths']);
    setLines('formatter-paths', ['formatters', 'exclusions', 'paths']);
  }

  function ensureConfig() {
    currentProfile.config = currentProfile.config || { version: '2' };
    currentProfile.config.version = '2';
    currentProfile.config.run = currentProfile.config.run || { tests: false };
    currentProfile.config.linters = currentProfile.config.linters || { default: 'none', enable: [] };
    currentProfile.config.linters.enable = currentProfile.config.linters.enable || [];
    currentProfile.config.formatters = currentProfile.config.formatters || { enable: [] };
    currentProfile.config.formatters.enable = currentProfile.config.formatters.enable || [];
  }

  function scheduleYamlValidation() {
    clearTimeout(validationTimer);
    validationTimer = setTimeout(function () {
      const editor = document.getElementById('yaml-editor');
      if (!editor) return;
      const requestId = ++validationRequest;
      latestValidation = requestId;
      yamlValid = false;
      document.getElementById('save-yaml').disabled = true;
      vscode.postMessage({
        type: 'validateYaml',
        requestId: requestId,
        yaml: editor.value
      });
    }, 220);
  }

  function showYamlValidation(errors) {
    const validation = document.getElementById('yaml-validation');
    const save = document.getElementById('save-yaml');
    if (!validation || !save) return;
    yamlValid = errors.length === 0;
    validation.className = yamlValid ? 'validation ok' : 'validation error';
    validation.textContent = yamlValid
      ? tr('valid')
      : errors.join(' ');
    save.disabled = !yamlValid;
  }

  function refreshYamlHighlight() {
    const editor = document.getElementById('yaml-editor');
    const highlight = document.getElementById('yaml-highlight');
    if (!editor || !highlight) return;
    highlight.innerHTML = highlightYaml(editor.value) + '\n';
  }

  function highlightYaml(value) {
    return escapeHtml(value).split('\n').map(function (line) {
      if (/^\s*#/u.test(line)) {
        return '<span class="yaml-comment">' + line + '</span>';
      }
      return line
        .replace(/^(\s*)([\w.-]+)(\s*:)/u, '$1<span class="json-key">$2</span>$3')
        .replace(/(:\s*)(true|false|null|\d+)(\s*)$/u, '$1<span class="json-literal">$2</span>$3')
        .replace(/(:\s*)(&quot;.*?&quot;|'.*?')(\s*)$/u, '$1<span class="json-string">$2</span>$3');
    }).join('\n');
  }

  function syncYamlScroll() {
    const editor = document.getElementById('yaml-editor');
    const highlight = document.getElementById('yaml-highlight');
    if (editor && highlight) {
      highlight.scrollTop = editor.scrollTop;
      highlight.scrollLeft = editor.scrollLeft;
    }
  }

  function filterLinters(query) {
    const normalized = query.trim().toLowerCase();
    document.querySelectorAll('[data-catalog-name]').forEach(function (item) {
      item.style.display = item.dataset.catalogName.includes(normalized) ? 'flex' : 'none';
    });
  }

  function updateSelectionCount() {
    const target = document.getElementById('selection-count');
    if (target) {
      target.textContent = document.querySelectorAll('[data-linter]:checked').length + ' ' + tr('selected');
    }
  }

  function renderReport(value) {
    if (!value) return '';
    const problems = value.problems.map(function (item) {
      const label = item.severity === 'error'
        ? tr('error')
        : item.severity === 'warning' ? tr('warningShort') : tr('information');
      return '<button class="problem" data-action="openProblem" data-uri="' +
        escapeAttribute(item.uri || value.uri) + '" data-line="' + item.line + '" data-column="' +
        item.column + '"><span class="severity ' + item.severity + '">' + label +
        '</span><span class="problem-message"><strong>' + escapeHtml(item.message) +
        '</strong><span>' + (item.fileName ? escapeHtml(item.fileName) + ' · ' : '') +
        tr('line') + ' ' + (item.line + 1) + ', ' + tr('column') + ' ' + (item.column + 1) +
        ' · ' + escapeHtml(item.linter) + '</span></span><span>' +
        (item.fixable ? 'Quick Fix' : '') + '</span></button>';
    }).join('');
    return '<section class="report" id="report"><div class="report-title"><h2>' + tr('report') + ': ' +
      escapeHtml(value.fileName) + '</h2><button class="ghost report-reset" ' +
      'data-action="resetReport" title="' + tr('resetTitle') + '">' +
      tr('reset') + '</button></div><p class="report-meta">' +
      escapeHtml(value.engine || 'golangci-lint') +
      ' · ' + tr('profile') + ' «' + escapeHtml(value.profileName) + '» · ' + value.durationMs +
      ' ' + tr('milliseconds') + '</p><div class="report-summary"><span class="metric">' + tr('errors') + ': ' +
      value.errors + '</span><span class="metric">' + tr('warnings') + ': ' + value.warnings +
      '</span><span class="metric">' + tr('information') + ': ' + value.information +
      '</span></div><div class="problem-list">' +
      (problems || '<p class="success">' + tr('noProblems') + '</p>') + '</div></section>';
  }

  function renderLintStatus(value) {
    if (!value) return '';
    if (value.phase === 'error') {
      return '<section class="report report-error" id="report">' +
        '<div class="report-status-head"><span class="status-icon error">!</span><div>' +
        '<h2>' + tr('notCompleted') + ': ' + escapeHtml(value.fileName) + '</h2>' +
        '<p class="report-meta">' + tr('profile') + ' «' + escapeHtml(value.profileName) +
        '»</p></div></div><p class="status-message error">' +
        escapeHtml(value.message || tr('lintFailed')) +
        '</p></section>';
    }
    return '<section class="report report-running" id="report">' +
      '<div class="report-status-head"><span class="spinner" aria-hidden="true"></span><div>' +
      '<h2>' + tr('result') + ': ' + escapeHtml(value.fileName) + '</h2>' +
      '<p class="report-meta">' + tr('profile') + ' «' + escapeHtml(value.profileName) +
      '»</p></div></div><p class="status-message">' +
      tr('running') + '</p>' +
      (value.coldCache
        ? '<div class="cold-cache"><strong>' + tr('coldTitle') + '</strong>' +
          '<span>' + tr('coldText') + '</span></div>'
        : '<div class="warm-cache"><strong>' + tr('warmTitle') + '</strong>' +
          '<span>' + tr('warmText') + '</span></div>') +
      '</section>';
  }

  function showInlineErrors(errors) {
    const target = document.getElementById('inline-errors') ||
      document.getElementById('yaml-validation');
    if (target) {
      target.className = 'validation error';
      target.textContent = errors.join(' ');
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function setNumber(id, path) {
    const input = document.getElementById(id);
    if (input) writeNested(currentProfile.config, path, Number(input.value));
  }

  function setLines(id, path) {
    const input = document.getElementById(id);
    if (input) {
      writeNested(currentProfile.config, path, input.value.split(/\r?\n/u)
        .map(function (item) { return item.trim(); }).filter(Boolean));
    }
  }

  function readNested(root, path, fallback) {
    let value = root;
    for (const key of path) {
      if (!value || typeof value !== 'object' || !(key in value)) return fallback;
      value = value[key];
    }
    return value ?? fallback;
  }

  function writeNested(root, path, value) {
    let target = root;
    path.slice(0, -1).forEach(function (key) {
      if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
        target[key] = {};
      }
      target = target[key];
    });
    target[path[path.length - 1]] = value;
  }

  function stepButton(number, title) {
    return '<button class="step ' + (editorStep === number ? 'active' : '') +
      '" data-action="step" data-step="' + number + '">' + title + '</button>';
  }

  function option(value, label, selected) {
    return '<option value="' + value + '"' + (value === selected ? ' selected' : '') +
      '>' + label + '</option>';
  }

  function slugFile(name) {
    const slug = String(name || '').normalize('NFKD').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return (slug || 'golangci') + '.golangci.yml';
  }

  function displayFileName(profileId) {
    return String(profileId || '').replace(/^(global|workspace):/u, '');
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function persist() {
    vscode.setState({
      dashboard: dashboard,
      selectedFile: selectedFile,
      report: report
    });
  }

  vscode.postMessage({ type: 'ready' });
  render();
}());
