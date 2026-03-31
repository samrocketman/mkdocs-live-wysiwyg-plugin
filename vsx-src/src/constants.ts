export const WYSIWYG_VERSION = '0.3.21';

export const PYTHON_VERSION = '3.13';

export const PIP_PACKAGES = [
  'mkdocs-techdocs-core',
  'mkdocs-same-dir',
  'mkdocs-gen-files',
  'mkdocstrings',
  'mkdocstrings-python',
  'mkdocs-nav-weight',
  'griffe',
  'websockets',
  'mkdocs-live-edit-plugin',
  `mkdocs-live-wysiwyg-plugin==${WYSIWYG_VERSION}`,
];

export const DEFAULT_HTTP_PORT = 8000;
export const DEFAULT_WEBSOCKET_PORT = 8484;
export const DEFAULT_API_PORT = 8485;
export const DEFAULT_HOST = '127.0.0.1';
export const MAX_PORT_RETRIES = 100;

export const TECHDOCS_DIR = '.techdocs';
export const VENV_DIR = 'python3';

export const MANAGED_PLUGINS = ['search', 'techdocs-core', 'live-edit', 'live-wysiwyg'];

export const REQUIRED_MARKDOWN_EXTENSIONS = ['admonition', 'pymdownx.details'];
