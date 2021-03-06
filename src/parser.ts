import * as fs from 'fs';
import * as path from 'path';
import Package from './package';

const SEP:RegExp = new RegExp('\\' + path.sep, 'g');
const defaultPath2url:Function = (x:string):string => JSON.stringify(x.replace(/\.js$/, ''));
let singleton:any;

export default class Parser {
    modulesPath:string;
    projectPath:string;
    constructor (projectPath:string, modulesPath?: string) {
        this.modulesPath = modulesPath ? path.resolve(modulesPath) : this.resolveModulesPath(projectPath);
        this.projectPath = path.resolve(projectPath);
    }
    resolveModulesPath (projectPath:string):string {
        const filepath = this.findPackageJson(projectPath);
        if (!filepath) {
            return path.resolve(projectPath, 'amd_modules');
        }
        const pkg = Package.loadJson(filepath);
        const relativePath = pkg.amdPrefix || 'amd_modules';
        return path.resolve(filepath, '..', relativePath);
    }
    findPackageJson (dir:string):any {
        const pathname = path.resolve(dir, 'package.json');
        if (fs.existsSync(pathname)) {
            return pathname;
        }
        const parent = path.resolve(dir, '..');
        if (parent === dir) {
            return null;
        }
        return this.findPackageJson(parent);
    }
    inModules (fullname:string):boolean {
        return fullname.indexOf(this.modulesPath) === 0;
    }
    isEntryFile (fullname:string):any {
        if (!this.inModules(fullname)) {
            return false;
        }
        if (path.extname(fullname) !== '.js') {
            return false;
        }
        const relative = fullname.slice(this.modulesPath.length + 1, -3);
        const tokens = relative.split('/');
        if (tokens.length > 2) {
            return false;
        }
        if (tokens.length === 2) {
            return relative[0] === '@' ? relative : false;
        }
        return relative;
    }
    inlinePackage (id:string, fileObj:any):string {
        const file = path.resolve(this.modulesPath, id) + '.js';
        const relative = this.relativePath(file);
        if (fileObj.cache) {
            fileObj.cache.addDeps(file);
        }
        return '__inline(' + JSON.stringify(relative) + ');';
    }
    inlineDependencies (pkgName:string, fileObj:any):string {
        const pkgPath = path.resolve(this.modulesPath, pkgName);
        const pkg = Package.create(pkgPath);
        const inlines = pkg.getFiles();

        if (fileObj.cache) {
            inlines.forEach(filepath => fileObj.cache.addDeps(filepath));
        }
        const text = inlines
            .map(file => this.relativePath(file))
            .map(path => '__inline(' + JSON.stringify(path) + ');')
            .join('\n');
        return text;
    }
    parse (content:string, file:any, settings: any):string {
        const pkgName = this.isEntryFile(file.path);
        if (pkgName) {
            return this.inlineDependencies(pkgName, file) + '\n' + content + ';';
        }
        return content
            .replace(
                /__inlinePackage\(['"](.*)['"]\)/g,
                (match, id) => this.inlinePackage(id, file)
            )
            .replace(
                /__AMD_CONFIG/g,
                () => this.amdConfig(settings.path2url, file)
            );
    }
    static create (projectPath: string, modulesPath?: string): Parser {
        if (!singleton) {
            singleton = new Parser(projectPath, modulesPath);
        }
        return singleton;
    }
    amdConfig (path2url:Function, fileObj: any):string {
        path2url = path2url || defaultPath2url;
        const lines = Package.getInstalledPackageDirs(this.modulesPath)
            .map(dir => {
                const file = dir + '.js';
                if (fileObj.cache) {
                    fileObj.cache.addDeps(file);
                }
                const relativePath = this.relativePath(file);
                const url = path2url(relativePath);
                const id = this.amdID(file);
                return `    "${id}": ${url}`;
            });

        return '{\n' + lines.join(',\n') + '\n}';
    }
    relativePath (fullpath:string):string {
        return fullpath.replace(this.projectPath, '').replace(SEP, '/');
    }
    amdID (fullpath:string):string {
        return fullpath.replace(this.modulesPath, '')
            .replace(/\.js$/, '')
            .replace(SEP, '/')
            .replace(/^\//, '');
    }
}
