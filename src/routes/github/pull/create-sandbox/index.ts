import { generate as generateShortid } from 'shortid';
import { pickBy } from 'lodash';
import { join } from 'path';

import { IGitHubFiles } from '../extract';
import {
  INormalizedModules,
  IModule,
} from '../../../../utils/sandbox/normalize';
import denormalize, {
  ISandboxFile,
  ISandboxDirectory,
} from '../../../../utils/sandbox/denormalize';

import mapDependencies from './dependency-mapper';
import getDependencyRequiresFromFiles from './dependency-analyzer';
import parseHTML from './html-parser';
import { getMainFile, getTemplate } from './templates';

/**
 * Get which dependencies are needed and map them to the latest version, needs
 * files to determine which devDependencies are used in the code.
 *
 * @param packageJSON PackageJSON containing all dependencies
 * @param files files with code about which dependencies are used
 */
async function getDependencies(
  packageJSON: {
    dependencies: { [key: string]: string };
    devDependencies: { [key: string]: string };
  },
  files: ISandboxFile[]
) {
  const { dependencies = {}, devDependencies = {} } = packageJSON;

  const dependenciesInFiles = getDependencyRequiresFromFiles(files);

  // Filter the devDependencies that are actually used in files
  const depsToMatch = pickBy(devDependencies, (_, key) =>
    dependenciesInFiles.some(dep => dep.startsWith(key))
  ) as IDependencies;

  // Exclude some dependencies that are not needed in CodeSandbox
  const alteredDependencies = await mapDependencies({
    ...dependencies,
    ...depsToMatch,
  });
  return alteredDependencies;
}

function getHTMLInfo(html: IModule | undefined) {
  if (!html) {
    return { externalResources: [], file: null };
  }

  const { body, externalResources } = parseHTML(html.content);

  if (body) {
    html.content = body;
  }

  return { externalResources, file: html };
}

/**
 * Creates all relevant data for create a sandbox, like dependencies and which
 * files are in a sandbox
 *
 * @export SandboxObject
 * @param {Array<Module>} files
 * @param {Array<Module>} directories
 */
export default async function createSandbox(directory: INormalizedModules) {
  const packageJson = directory['package.json'];
  if (!packageJson) throw new Error('Could not find package.json');

  const packageJsonPackage = JSON.parse(packageJson.content);

  const template = getTemplate(packageJsonPackage, directory);
  const mainFile = packageJsonPackage.main || getMainFile(template);

  if (!directory[mainFile]) {
    throw new Error(`Cannot find the entry point: '${mainFile}'`);
  }

  // Fetch index html seperately, we need to extract external resources and
  // the body from it
  let indexHTML = directory['index.html'] || directory['public/index.html'];

  const htmlInfo = getHTMLInfo(indexHTML);
  const { modules, directories } = denormalize(directory);

  // Give the sandboxModules to getDependencies to fetch which devDependencies
  // are used in the code
  const dependencies = await getDependencies(packageJsonPackage, modules);

  console.log('Creating sandbox with template ' + template);

  return {
    title: packageJsonPackage.title || packageJsonPackage.name,
    description: packageJsonPackage.description,
    tags: packageJsonPackage.keywords || [],
    modules,
    directories,
    npmDependencies: dependencies,
    externalResources: htmlInfo.externalResources,
    template,
    entry: mainFile,
  };
}
