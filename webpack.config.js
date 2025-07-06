//@ts-check // Use JSDoc comments for type checking

"use strict";

const path = require("path");
const webpack = require("webpack"); // Required for BannerPlugin

/**@type {import('webpack').Configuration}*/
const baseConfig = {
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: "ts-loader",
					},
				],
			},
		],
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	output: {
		libraryTarget: "commonjs2",
		devtoolModuleFilenameTemplate: "../[resource-path]",
	},
	devtool: "source-map", // Or 'nosources-source-map' for production
};

/**@type {import('webpack').Configuration}*/
const extensionConfig = {
	...baseConfig, // Inherit base configuration
	target: "node", // VS Code extensions run in a Node.js-context
	mode: "none", // Keep this as is from generator (or set 'production'/'development')

	entry: "./src/extension.ts", // The entry point of your extension
	output: {
		// Compile output to 'dist' folder
		path: path.resolve(__dirname, "dist"),
		filename: "extension.js",
		libraryTarget: "commonjs2",
	},
	externals: {
		vscode: "commonjs vscode", // The vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
		// modules added here also need to be added in the .vscodeignore file
	},
};

/**@type {import('webpack').Configuration}*/
const webviewConfig = {
	...baseConfig, // Inherit base configuration
	target: "web",
	mode: "none", // Or 'production'/'development'

	entry: "./src/sidebar/webview/main.ts", // Entry point for the webview script
	output: {
		path: path.resolve(__dirname, "dist"), // Output webview bundle to 'dist' as well
		filename: "webview.js", // Name the webview bundle
		libraryTarget: "module", // Use module for modern webviews
	},
	experiments: {
		// Required for libraryTarget: 'module'
		outputModule: true,
	},
};

module.exports = [extensionConfig, webviewConfig];
