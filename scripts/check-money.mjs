import ts from 'typescript';
import { readdirSync } from 'node:fs';
const collect = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? collect(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [`${dir}/${entry.name}`] : []);
const files = collect('src/engine');
const program = ts.createProgram(files, { strict: true, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, skipLibCheck: true });
const checker = program.getTypeChecker();
const errors = [];
const arithmetic = new Set([ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken]);
const isText = node => (checker.getTypeAtLocation(node).flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0;
for (const file of program.getSourceFiles().filter(file => files.some(name => file.fileName.replaceAll('\\', '/').endsWith(name)))) {
  const fail = (node, message) => errors.push(`${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`);
  const visit = node => {
    if (ts.isTypeAliasDeclaration(node) && ['Money', 'AnnualRate'].includes(node.name.text) && !(checker.getTypeAtLocation(node).flags & ts.TypeFlags.String)) fail(node, 'Money and rates must remain decimal text.');
    if (ts.isCallExpression(node) && ['Number', 'parseFloat', 'parseInt'].includes(node.expression.getText(file)) && node.arguments.some(isText)) fail(node, 'Do not convert decimal text to floating point.');
    if (ts.isBinaryExpression(node) && arithmetic.has(node.operatorToken.kind) && (isText(node.left) || isText(node.right))) fail(node, 'Use decimal arithmetic for decimal text.');
    if (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator) && isText(node.operand)) fail(node, 'Do not coerce decimal text to floating point.');
    ts.forEachChild(node, visit);
  };
  visit(file);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Money lint passed: decimal aliases and engine string arithmetic/coercion checks.');
