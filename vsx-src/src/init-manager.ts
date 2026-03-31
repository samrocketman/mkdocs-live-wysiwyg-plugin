import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Copy the bundled example-docs from the extension's resources/ into the
 * workspace, mirroring techdocs-preview.sh's `init_docs` which extracts
 * the same example-docs tarball. The source of truth is the example-docs/
 * directory at the repo root, which is copied into resources/ during the
 * VSIX build (see Makefile pre-build target).
 */
export async function initDocs(
  extensionPath: string,
  workspaceDir: string,
  output: vscode.OutputChannel
): Promise<void> {
  const mkdocsYmlPath = path.join(workspaceDir, 'mkdocs.yml');
  const docsDir = path.join(workspaceDir, 'docs');

  if (fs.existsSync(mkdocsYmlPath)) {
    vscode.window.showErrorMessage(
      'mkdocs.yml already exists. Cannot init where documentation is already present.'
    );
    return;
  }
  if (fs.existsSync(docsDir)) {
    vscode.window.showErrorMessage(
      'docs/ directory already exists. Cannot init where documentation is already present.'
    );
    return;
  }

  const exampleDocsDir = path.join(extensionPath, 'resources', 'example-docs');
  if (!fs.existsSync(exampleDocsDir)) {
    vscode.window.showErrorMessage(
      'Bundled example-docs not found. The extension may not have been built correctly.'
    );
    return;
  }

  fs.cpSync(exampleDocsDir, workspaceDir, { recursive: true });
  output.appendLine(`Copied example-docs into ${workspaceDir}`);

  const gitignorePath = path.join(workspaceDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, 'site\n');
  } else {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.split('\n').includes('site')) {
      fs.appendFileSync(gitignorePath, 'site\n');
    }
  }

  output.appendLine('Initialized example MkDocs documentation.');
  vscode.window.showInformationMessage(
    'MkDocs documentation initialized. Run "Start Server" to preview.'
  );
}
