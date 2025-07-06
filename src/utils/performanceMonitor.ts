import * as vscode from "vscode";

// Performance monitoring interface
export interface PerformanceMetrics {
	operation: string;
	duration: number;
	timestamp: number;
	metadata?: Record<string, any>;
}

// Performance thresholds
export const PERFORMANCE_THRESHOLDS = {
	SCAN_TIME_WARNING: 5000, // 5 seconds
	DEPENDENCY_BUILD_TIME_WARNING: 10000, // 10 seconds
	CONTEXT_BUILD_TIME_WARNING: 15000, // 15 seconds
	AI_SELECTION_TIME_WARNING: 10000, // 10 seconds
	SYMBOL_PROCESSING_TIME_WARNING: 8000, // 8 seconds
	FILE_SUMMARY_TIME_WARNING: 5000, // 5 seconds
};

// Performance categories
export const PERFORMANCE_CATEGORIES = {
	WORKSPACE_SCAN: "workspace_scan",
	DEPENDENCY_BUILD: "dependency_build",
	CONTEXT_BUILD: "context_build",
	AI_SELECTION: "ai_selection",
	SYMBOL_PROCESSING: "symbol_processing",
	FILE_SUMMARY: "file_summary",
	CACHE_OPERATION: "cache_operation",
} as const;

export class PerformanceMonitor {
	private metrics: PerformanceMetrics[] = [];
	private isEnabled: boolean = true;
	private maxMetrics: number = 1000; // Keep last 1000 metrics

	constructor(private readonly postMessageToWebview?: (message: any) => void) {}

	/**
	 * Start timing an operation
	 */
	startTimer(operation: string): () => void {
		const startTime = Date.now();

		return (metadata?: Record<string, any>) => {
			this.recordMetric(operation, Date.now() - startTime, metadata);
		};
	}

	/**
	 * Record a performance metric
	 */
	recordMetric(
		operation: string,
		duration: number,
		metadata?: Record<string, any>
	): void {
		if (!this.isEnabled) {
			return;
		}

		const metric: PerformanceMetrics = {
			operation,
			duration,
			timestamp: Date.now(),
			metadata,
		};

		this.metrics.push(metric);

		// Keep only the last maxMetrics
		if (this.metrics.length > this.maxMetrics) {
			this.metrics = this.metrics.slice(-this.maxMetrics);
		}

		// Check if this operation exceeded any thresholds
		this.checkThresholds(metric);
	}

	/**
	 * Check if a metric exceeds performance thresholds
	 */
	private checkThresholds(metric: PerformanceMetrics): void {
		const threshold = this.getThresholdForOperation(metric.operation);
		if (threshold && metric.duration > threshold) {
			console.warn(
				`[PerformanceMonitor] ${metric.operation} took ${metric.duration}ms (threshold: ${threshold}ms)`
			);

			if (this.postMessageToWebview) {
				this.postMessageToWebview({
					type: "performanceWarning",
					value: {
						operation: metric.operation,
						duration: metric.duration,
						threshold,
						metadata: metric.metadata,
					},
				});
			}
		}
	}

	/**
	 * Get threshold for a specific operation
	 */
	private getThresholdForOperation(operation: string): number | undefined {
		switch (operation) {
			case PERFORMANCE_CATEGORIES.WORKSPACE_SCAN:
				return PERFORMANCE_THRESHOLDS.SCAN_TIME_WARNING;
			case PERFORMANCE_CATEGORIES.DEPENDENCY_BUILD:
				return PERFORMANCE_THRESHOLDS.DEPENDENCY_BUILD_TIME_WARNING;
			case PERFORMANCE_CATEGORIES.CONTEXT_BUILD:
				return PERFORMANCE_THRESHOLDS.CONTEXT_BUILD_TIME_WARNING;
			case PERFORMANCE_CATEGORIES.AI_SELECTION:
				return PERFORMANCE_THRESHOLDS.AI_SELECTION_TIME_WARNING;
			case PERFORMANCE_CATEGORIES.SYMBOL_PROCESSING:
				return PERFORMANCE_THRESHOLDS.SYMBOL_PROCESSING_TIME_WARNING;
			case PERFORMANCE_CATEGORIES.FILE_SUMMARY:
				return PERFORMANCE_THRESHOLDS.FILE_SUMMARY_TIME_WARNING;
			default:
				return undefined;
		}
	}

	/**
	 * Get performance statistics
	 */
	getStatistics(): {
		totalMetrics: number;
		averageDuration: number;
		slowestOperations: PerformanceMetrics[];
		operationBreakdown: Record<
			string,
			{ count: number; avgDuration: number; maxDuration: number }
		>;
	} {
		if (this.metrics.length === 0) {
			return {
				totalMetrics: 0,
				averageDuration: 0,
				slowestOperations: [],
				operationBreakdown: {},
			};
		}

		const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
		const averageDuration = totalDuration / this.metrics.length;

		// Get slowest operations
		const slowestOperations = [...this.metrics]
			.sort((a, b) => b.duration - a.duration)
			.slice(0, 10);

		// Get operation breakdown
		const operationBreakdown: Record<
			string,
			{ count: number; totalDuration: number; maxDuration: number }
		> = {};

		for (const metric of this.metrics) {
			if (!operationBreakdown[metric.operation]) {
				operationBreakdown[metric.operation] = {
					count: 0,
					totalDuration: 0,
					maxDuration: 0,
				};
			}

			operationBreakdown[metric.operation].count++;
			operationBreakdown[metric.operation].totalDuration += metric.duration;
			operationBreakdown[metric.operation].maxDuration = Math.max(
				operationBreakdown[metric.operation].maxDuration,
				metric.duration
			);
		}

		// Convert to final format
		const breakdown = Object.entries(operationBreakdown).reduce(
			(acc, [operation, stats]) => {
				acc[operation] = {
					count: stats.count,
					avgDuration: stats.totalDuration / stats.count,
					maxDuration: stats.maxDuration,
				};
				return acc;
			},
			{} as Record<
				string,
				{ count: number; avgDuration: number; maxDuration: number }
			>
		);

		return {
			totalMetrics: this.metrics.length,
			averageDuration,
			slowestOperations,
			operationBreakdown: breakdown,
		};
	}

	/**
	 * Get recent metrics for a specific operation
	 */
	getRecentMetrics(
		operation: string,
		limit: number = 50
	): PerformanceMetrics[] {
		return this.metrics.filter((m) => m.operation === operation).slice(-limit);
	}

	/**
	 * Clear all metrics
	 */
	clearMetrics(): void {
		this.metrics = [];
	}

	/**
	 * Enable or disable performance monitoring
	 */
	setEnabled(enabled: boolean): void {
		this.isEnabled = enabled;
	}

	/**
	 * Check if monitoring is enabled
	 */
	isMonitoringEnabled(): boolean {
		return this.isEnabled;
	}

	/**
	 * Get metrics for a time range
	 */
	getMetricsInRange(startTime: number, endTime: number): PerformanceMetrics[] {
		return this.metrics.filter(
			(m) => m.timestamp >= startTime && m.timestamp <= endTime
		);
	}

	/**
	 * Get metrics for the last N minutes
	 */
	getMetricsForLastMinutes(minutes: number): PerformanceMetrics[] {
		const cutoffTime = Date.now() - minutes * 60 * 1000;
		return this.metrics.filter((m) => m.timestamp >= cutoffTime);
	}

	/**
	 * Export metrics for analysis
	 */
	exportMetrics(): PerformanceMetrics[] {
		return [...this.metrics];
	}

	/**
	 * Import metrics (useful for debugging)
	 */
	importMetrics(metrics: PerformanceMetrics[]): void {
		this.metrics = [...this.metrics, ...metrics];
	}
}

// Global performance monitor instance
let globalPerformanceMonitor: PerformanceMonitor | undefined;

/**
 * Get the global performance monitor instance
 */
export function getPerformanceMonitor(): PerformanceMonitor {
	if (!globalPerformanceMonitor) {
		globalPerformanceMonitor = new PerformanceMonitor();
	}
	return globalPerformanceMonitor;
}

/**
 * Set the global performance monitor instance
 */
export function setPerformanceMonitor(monitor: PerformanceMonitor): void {
	globalPerformanceMonitor = monitor;
}

/**
 * Convenience function to time an operation
 */
export async function timeOperation<T>(
	operation: string,
	operationFn: () => Promise<T>,
	metadata?: Record<string, any>
): Promise<T> {
	const monitor = getPerformanceMonitor();
	const stopTimer = monitor.startTimer(operation);

	try {
		const result = await operationFn();
		stopTimer();
		return result;
	} catch (error) {
		stopTimer();
		throw error;
	}
}

/**
 * Convenience function to time a synchronous operation
 */
export function timeSyncOperation<T>(
	operation: string,
	operationFn: () => T,
	metadata?: Record<string, any>
): T {
	const monitor = getPerformanceMonitor();
	const stopTimer = monitor.startTimer(operation);

	try {
		const result = operationFn();
		stopTimer();
		return result;
	} catch (error) {
		stopTimer();
		throw error;
	}
}
