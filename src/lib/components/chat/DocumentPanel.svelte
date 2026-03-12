<script lang="ts">
	import { FileText, X, Trash2, RefreshCw, Download, Search, FileSpreadsheet, FileImage, Mail, Archive, Code, File } from '@lucide/svelte';
	import * as m from '$lib/paraglide/messages';
	import ConfirmDialog from './ConfirmDialog.svelte';

	let {
		open,
		onClose,
		roomId,
		userRole,
		initialSearch = ''
	}: {
		open: boolean;
		onClose: () => void;
		roomId: string;
		userRole: string;
		initialSearch?: string;
	} = $props();

	interface DocFile {
		id: number;
		filename: string;
		content_type: string;
		size_bytes: number;
		processing_status: string;
		extraction_error_code: string | null;
		created_at: string | null;
	}

	let files = $state<DocFile[]>([]);
	let loading = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<Array<{ content: string; filename: string; score: number; chunk_index: number; char_start: number; char_end: number }>>([]);
	let searching = $state(false);
	let deleting = $state<number | null>(null);
	let retrying = $state<number | null>(null);
	let deleteConfirmId = $state<number | null>(null);
	let ocrEnabled = $state(false);
	let ocrLoading = $state(false);
	let reindexing = $state(false);

	const canDelete = $derived(userRole === 'owner' || userRole === 'lead');
	const canManage = $derived(userRole === 'owner' || userRole === 'lead');

	const filteredFiles = $derived(
		searchQuery.trim() && !searchResults.length
			? files.filter((f) => f.filename.toLowerCase().includes(searchQuery.toLowerCase()))
			: files
	);

	$effect(() => {
		if (open) {
			loadFiles();
			loadOcrStatus();
		}
	});

	// When opened via citation click, pre-fill search
	$effect(() => {
		if (initialSearch && open) {
			searchQuery = initialSearch;
			doSearch();
		}
	});

	// Auto-refresh when a document finishes indexing (via WebSocket)
	$effect(() => {
		function onDocIndexed() { loadFiles(); }
		window.addEventListener('document-indexed', onDocIndexed);
		return () => window.removeEventListener('document-indexed', onDocIndexed);
	});

	async function loadFiles() {
		loading = true;
		try {
			const res = await fetch('/api/upload/files');
			const json: { ok?: boolean; data?: DocFile[] } = await res.json();
			if (json.ok && json.data) files = json.data;
		} catch { /* silent */ }
		loading = false;
	}

	function confirmDelete(id: number) {
		deleteConfirmId = id;
	}

	async function deleteFile(id: number) {
		deleteConfirmId = null;
		deleting = id;
		try {
			const res = await fetch('/api/upload/files', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				files = files.filter((f) => f.id !== id);
			}
		} catch { /* silent */ }
		deleting = null;
	}

	async function retryFile(id: number) {
		retrying = id;
		try {
			const res = await fetch('/api/upload/files/retry', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (res.ok) {
				const f = files.find((f) => f.id === id);
				if (f) f.processing_status = 'pending';
			}
		} catch { /* silent */ }
		retrying = null;
	}

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	function onSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		if (!searchQuery.trim()) {
			searchResults = [];
			return;
		}
		searchTimer = setTimeout(() => doSearch(), 400);
	}

	async function doSearch() {
		if (!searchQuery.trim()) return;
		searching = true;
		try {
			const res = await fetch(`/api/rooms/${roomId}/documents/search?q=${encodeURIComponent(searchQuery)}`);
			const json: { ok?: boolean; data?: typeof searchResults } = await res.json();
			if (json.ok && json.data) searchResults = json.data;
		} catch { /* silent */ }
		searching = false;
	}

	async function loadOcrStatus() {
		try {
			const res = await fetch(`/api/rooms/${roomId}/ocr`);
			const json: { ok?: boolean; ocrEnabled?: boolean } = await res.json();
			if (json.ok) ocrEnabled = json.ocrEnabled ?? false;
		} catch { /* silent */ }
	}

	async function toggleOcr() {
		ocrLoading = true;
		try {
			const res = await fetch(`/api/rooms/${roomId}/ocr`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !ocrEnabled })
			});
			const json: { ok?: boolean; ocrEnabled?: boolean } = await res.json();
			if (json.ok) ocrEnabled = json.ocrEnabled ?? false;
		} catch { /* silent */ }
		ocrLoading = false;
	}

	async function reindexImages() {
		reindexing = true;
		try {
			const res = await fetch(`/api/rooms/${roomId}/ocr`, {
				method: 'POST'
			});
			const json: { ok?: boolean; queued?: number } = await res.json();
			if (json.ok && json.queued && json.queued > 0) {
				// Refresh file list to show updated statuses
				await loadFiles();
			}
		} catch { /* silent */ }
		reindexing = false;
	}

	const skippedImageCount = $derived(
		files.filter((f) => f.processing_status === 'skipped' && f.content_type.startsWith('image/')).length
	);

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatTime(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		const diff = Date.now() - d.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h`;
		const days = Math.floor(hrs / 24);
		return `${days}d`;
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'indexed': return 'var(--success)';
			case 'processing': case 'pending': return 'var(--warning, #f59e0b)';
			case 'failed': return 'var(--danger)';
			default: return 'var(--text-muted)';
		}
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'indexed': return 'Indexed';
			case 'processing': return 'Processing...';
			case 'pending': return 'Queued';
			case 'failed': return 'Failed';
			case 'skipped': return 'Skipped';
			default: return status;
		}
	}

	function getFileIcon(contentType: string) {
		if (contentType.startsWith('image/')) return FileImage;
		if (contentType.includes('spreadsheet') || contentType === 'text/csv') return FileSpreadsheet;
		if (contentType.includes('pdf') || contentType.includes('word') || contentType.includes('document') || contentType.includes('presentation') || contentType.includes('opendocument')) return FileText;
		if (contentType === 'message/rfc822' || contentType.includes('outlook')) return Mail;
		if (contentType.includes('zip') || contentType.includes('tar') || contentType.includes('7z') || contentType.includes('gzip')) return Archive;
		if (contentType === 'application/json' || contentType === 'text/yaml' || contentType.includes('xml') || contentType === 'text/html') return Code;
		return File;
	}
</script>

{#if open}
	<button
		class="fixed inset-0 z-30"
		style="background: rgba(0,0,0,0.5);"
		onclick={onClose}
		aria-label="Close document panel"
		tabindex="-1"
	></button>
{/if}

<aside
	class="fixed top-0 right-0 z-40 flex h-full flex-col transition-transform duration-200"
	style="
		width: 100%;
		max-width: 22rem;
		background: var(--bg-elevated);
		border-left: 1px solid var(--border);
		transform: translateX({open ? '0' : '100%'});
		padding-top: env(safe-area-inset-top);
	"
	aria-label="Documents"
>
	<!-- Header -->
	<div class="flex shrink-0 items-center justify-between border-b px-4 py-3" style="border-color: var(--border);">
		<div class="flex items-center gap-2">
			<FileText size={16} style="color: var(--text-muted);" />
			<span class="text-sm font-medium" style="color: var(--text); font-family: var(--font-mono);">
				Documents ({files.length})
			</span>
		</div>
		<button
			class="rounded p-1 transition-opacity hover:opacity-70"
			style="color: var(--text-muted);"
			onclick={onClose}
			aria-label="Close"
		>
			<X size={16} />
		</button>
	</div>

	<!-- Search -->
	<div class="shrink-0 border-b px-4 py-2" style="border-color: var(--border);">
		<div class="relative">
			<Search size={14} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" style="color: var(--text-muted);" />
			<input
				type="text"
				placeholder="Search documents..."
				bind:value={searchQuery}
				oninput={onSearchInput}
				class="w-full rounded-md py-1.5 pr-3 pl-8 text-xs"
				style="background: var(--bg); color: var(--text); border: 1px solid var(--border); font-family: var(--font-mono);"
			/>
		</div>
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-y-auto scrollbar-thin" style="padding-bottom: env(safe-area-inset-bottom);">
		{#if loading}
			<div class="flex items-center justify-center py-8" style="color: var(--text-muted);">
				<RefreshCw size={16} class="animate-spin" />
				<span class="ml-2 text-xs">Loading...</span>
			</div>
		{:else if searchQuery.trim() && searchResults.length > 0}
			<!-- Search results -->
			<div class="px-3 py-2">
				<span class="text-[10px] uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
					Search Results ({searchResults.length})
				</span>
			</div>
			{#each searchResults as result}
				<div class="border-b px-4 py-3" style="border-color: var(--border);">
					<div class="flex items-center gap-1.5">
						<FileText size={12} style="color: var(--accent);" />
						<span class="text-xs font-medium" style="color: var(--text); font-family: var(--font-mono);">
							{result.filename}
						</span>
						<span class="text-[10px]" style="color: var(--text-muted);">
							{Math.round(result.score * 100)}%
						</span>
					</div>
					<p class="mt-1 line-clamp-3 text-[11px] leading-relaxed" style="color: var(--text-muted);">
						{result.content.slice(0, 200)}{result.content.length > 200 ? '...' : ''}
					</p>
				</div>
			{/each}
		{:else if searching}
			<div class="flex items-center justify-center py-8" style="color: var(--text-muted);">
				<Search size={14} class="animate-pulse" />
				<span class="ml-2 text-xs">Searching...</span>
			</div>
		{:else if filteredFiles.length === 0}
			<div class="py-8 text-center text-xs" style="color: var(--text-muted);">
				{searchQuery ? 'No matching documents' : 'No documents uploaded yet'}
			</div>
		{:else}
			<!-- File list -->
			{#each filteredFiles as file (file.id)}
				{@const Icon = getFileIcon(file.content_type)}
				<div class="group flex items-start gap-3 border-b px-4 py-3 transition-colors" style="border-color: var(--border);">
					<div class="mt-0.5 shrink-0" style="color: var(--text-muted);">
						<Icon size={16} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="truncate text-xs font-medium" style="color: var(--text); font-family: var(--font-mono);" title={file.filename}>
								{file.filename}
							</span>
						</div>
						<div class="mt-0.5 flex items-center gap-2 text-[10px]" style="color: var(--text-muted);">
							<span
								class="inline-flex items-center gap-1"
								title={file.processing_status === 'failed' && file.extraction_error_code ? `Error: ${file.extraction_error_code}` : ''}
							>
								{#if file.processing_status === 'processing'}
									<RefreshCw size={10} class="animate-spin" style="color: {statusColor(file.processing_status)};" />
								{:else}
									<span class="inline-block h-1.5 w-1.5 rounded-full" style="background: {statusColor(file.processing_status)};"></span>
								{/if}
								{statusLabel(file.processing_status)}
							</span>
							<span>{formatSize(file.size_bytes)}</span>
							<span>{formatTime(file.created_at)}</span>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
						{#if file.processing_status === 'failed'}
							<button
								class="rounded p-1 transition-opacity hover:opacity-70"
								style="color: var(--warning, #f59e0b);"
								onclick={() => retryFile(file.id)}
								disabled={retrying === file.id}
								aria-label="Retry"
								title="Retry extraction"
							>
								<RefreshCw size={13} class={retrying === file.id ? 'animate-spin' : ''} />
							</button>
						{/if}
						<a
							href="/api/upload?key={file.filename}"
							class="rounded p-1 transition-opacity hover:opacity-70"
							style="color: var(--text-muted);"
							aria-label="Download"
							title="Download"
							download
						>
							<Download size={13} />
						</a>
						{#if canDelete}
							<button
								class="rounded p-1 transition-opacity hover:opacity-70"
								style="color: var(--danger);"
								onclick={() => confirmDelete(file.id)}
								disabled={deleting === file.id}
								aria-label="Delete"
								title="Delete file"
							>
								<Trash2 size={13} />
							</button>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Supported formats info -->
	<div class="shrink-0 border-t px-4 py-3" style="border-color: var(--border);">
		<span class="text-[10px] uppercase tracking-wider" style="color: var(--text-muted); font-family: var(--font-mono);">
			Supported for search
		</span>
		<p class="mt-1 text-[10px] leading-relaxed" style="color: var(--text-muted);">
			PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV, HTML, JSON, YAML, XML
		</p>
		<p class="mt-1 text-[10px] leading-relaxed" style="color: var(--text-muted);">
			Images — upload only (no text extraction)
		</p>
	</div>
</aside>

<ConfirmDialog
	open={deleteConfirmId !== null}
	title="Delete File"
	message="Delete this file? This cannot be undone."
	confirmLabel="Delete"
	variant="danger"
	onConfirm={() => { if (deleteConfirmId) deleteFile(deleteConfirmId); }}
	onCancel={() => { deleteConfirmId = null; }}
/>
