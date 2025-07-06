import * as vscode from "vscode";

export interface ParallelTask<T> {
	id: string;
	task: () => Promise<T>;
	priority: number;
	dependencies?: string[];
	timeout?: number;
	retries?: number;
}

export interface ParallelTaskResult<T> {
	id: string;
	result: T;
	duration: number;
	success: boolean;
	error?: string;
	retries: number;
}

export interface ParallelProcessorConfig {
	maxConcurrency: number;
	defaultTimeout: number;
	defaultRetries: number;
	enableRetries: boolean;
	enableTimeout: boolean;
}

export class ParallelProcessor {
	private static readonly DEFAULT_CONFIG: ParallelProcessorConfig = {
		maxConcurrency: 4,
		defaultTimeout: 30000, // 30 seconds
		defaultRetries: 2,
		enableRetries: true,
		enableTimeout: true,
	};

	/**
	 * Execute multiple tasks in parallel with concurrency control
	 */
	public static async executeParallel<T>(
		tasks: ParallelTask<T>[],
		config: Partial<ParallelProcessorConfig> = {}
	): Promise<Map<string, ParallelTaskResult<T>>> {
		const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
		const results = new Map<string, ParallelTaskResult<T>>();
		const running = new Set<string>();
		const completed = new Set<string>();
		const failed = new Set<string>();

		// Sort tasks by priority (higher priority first)
		const queue = [...tasks].sort((a, b) => b.priority - a.priority);

		const executeTask = async (task: ParallelTask<T>): Promise<void> => {
			const startTime = Date.now();
			let retries = 0;
			const maxRetries = task.retries ?? finalConfig.defaultRetries;

			while (retries <= maxRetries) {
				try {
					// Check dependencies
					if (task.dependencies) {
						const unmetDeps = task.dependencies.filter(
							(dep) => !completed.has(dep)
						);
						if (unmetDeps.length > 0) {
							throw new Error(`Dependencies not met: ${unmetDeps.join(", ")}`);
						}
					}

					running.add(task.id);

					// Execute task with optional timeout
					let result: T;
					if (finalConfig.enableTimeout) {
						const timeout = task.timeout ?? finalConfig.defaultTimeout;
						result = await Promise.race([
							task.task(),
							new Promise<never>((_, reject) =>
								setTimeout(
									() =>
										reject(
											new Error(`Task ${task.id} timed out after ${timeout}ms`)
										),
									timeout
								)
							),
						]);
					} else {
						result = await task.task();
					}

					const duration = Date.now() - startTime;
					results.set(task.id, {
						id: task.id,
						result,
						duration,
						success: true,
						retries,
					});

					completed.add(task.id);
					break; // Success, exit retry loop
				} catch (error) {
					retries++;
					const duration = Date.now() - startTime;

					if (retries > maxRetries) {
						// Final failure
						results.set(task.id, {
							id: task.id,
							result: null as T,
							duration,
							success: false,
							error: error instanceof Error ? error.message : String(error),
							retries,
						});
						failed.add(task.id);
					} else if (finalConfig.enableRetries) {
						// Wait before retry (exponential backoff)
						const delay = Math.min(1000 * Math.pow(2, retries - 1), 5000);
						await new Promise((resolve) => setTimeout(resolve, delay));
						continue; // Retry
					} else {
						// No retries enabled, fail immediately
						results.set(task.id, {
							id: task.id,
							result: null as T,
							duration,
							success: false,
							error: error instanceof Error ? error.message : String(error),
							retries,
						});
						failed.add(task.id);
						break;
					}
				} finally {
					running.delete(task.id);
				}
			}
		};

		// Process tasks with concurrency control
		while (queue.length > 0 || running.size > 0) {
			// Start new tasks if under concurrency limit
			while (running.size < finalConfig.maxConcurrency && queue.length > 0) {
				const task = queue.shift()!;

				// Check if task can be executed (dependencies met)
				if (task.dependencies) {
					const unmetDeps = task.dependencies.filter(
						(dep) => !completed.has(dep)
					);
					if (unmetDeps.length > 0) {
						// Put task back in queue for later execution
						queue.push(task);
						continue;
					}
				}

				executeTask(task).catch((error) => {
					console.error(`Failed to execute task ${task.id}:`, error);
				});
			}

			// Wait a bit before checking again
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return results;
	}

	/**
	 * Process multiple files in parallel
	 */
	public static async processFilesInParallel<T>(
		files: vscode.Uri[],
		processor: (file: vscode.Uri) => Promise<T>,
		config: Partial<ParallelProcessorConfig> = {}
	): Promise<Map<string, ParallelTaskResult<T>>> {
		const tasks: ParallelTask<T>[] = files.map((file, index) => ({
			id: file.fsPath,
			task: () => processor(file),
			priority: files.length - index, // Process files in order (higher index = higher priority)
			dependencies: [],
			timeout: config.defaultTimeout,
			retries: config.defaultRetries,
		}));

		return this.executeParallel(tasks, config);
	}

	/**
	 * Process files with dependency awareness
	 */
	public static async processFilesWithDependencies<T>(
		files: vscode.Uri[],
		processor: (file: vscode.Uri) => Promise<T>,
		dependencyGraph: Map<string, string[]>,
		config: Partial<ParallelProcessorConfig> = {}
	): Promise<Map<string, ParallelTaskResult<T>>> {
		const tasks: ParallelTask<T>[] = files.map((file, index) => {
			const filePath = file.fsPath;
			const dependencies = dependencyGraph.get(filePath) || [];

			return {
				id: filePath,
				task: () => processor(file),
				priority: files.length - index,
				dependencies: dependencies.length > 0 ? dependencies : undefined,
				timeout: config.defaultTimeout,
				retries: config.defaultRetries,
			};
		});

		return this.executeParallel(tasks, config);
	}

	/**
	 * Execute tasks in batches for memory management
	 */
	public static async executeInBatches<T>(
		tasks: ParallelTask<T>[],
		batchSize: number = 10,
		config: Partial<ParallelProcessorConfig> = {}
	): Promise<Map<string, ParallelTaskResult<T>>> {
		const allResults = new Map<string, ParallelTaskResult<T>>();

		for (let i = 0; i < tasks.length; i += batchSize) {
			const batch = tasks.slice(i, i + batchSize);
			const batchResults = await this.executeParallel(batch, config);

			// Merge batch results
			for (const [id, result] of batchResults) {
				allResults.set(id, result);
			}

			// Optional: Add delay between batches to prevent overwhelming the system
			if (i + batchSize < tasks.length) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		return allResults;
	}

	/**
	 * Get execution statistics
	 */
	public static getExecutionStats<T>(
		results: Map<string, ParallelTaskResult<T>>
	): {
		totalTasks: number;
		successfulTasks: number;
		failedTasks: number;
		averageDuration: number;
		totalDuration: number;
		successRate: number;
	} {
		const totalTasks = results.size;
		const successfulTasks = Array.from(results.values()).filter(
			(r) => r.success
		).length;
		const failedTasks = totalTasks - successfulTasks;
		const totalDuration = Array.from(results.values()).reduce(
			(sum, r) => sum + r.duration,
			0
		);
		const averageDuration = totalTasks > 0 ? totalDuration / totalTasks : 0;
		const successRate =
			totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0;

		return {
			totalTasks,
			successfulTasks,
			failedTasks,
			averageDuration,
			totalDuration,
			successRate,
		};
	}

	/**
	 * Create a task with automatic retry logic
	 */
	public static createRetryTask<T>(
		id: string,
		task: () => Promise<T>,
		options: {
			priority?: number;
			dependencies?: string[];
			timeout?: number;
			retries?: number;
		} = {}
	): ParallelTask<T> {
		return {
			id,
			task,
			priority: options.priority ?? 0,
			dependencies: options.dependencies,
			timeout: options.timeout,
			retries: options.retries,
		};
	}

	/**
	 * Create a task that depends on other tasks
	 */
	public static createDependentTask<T>(
		id: string,
		task: () => Promise<T>,
		dependencies: string[],
		options: {
			priority?: number;
			timeout?: number;
			retries?: number;
		} = {}
	): ParallelTask<T> {
		return {
			id,
			task,
			priority: options.priority ?? 0,
			dependencies,
			timeout: options.timeout,
			retries: options.retries,
		};
	}
}
