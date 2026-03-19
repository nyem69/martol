#!/usr/bin/env node
/**
 * RAG Evaluation Script
 *
 * Tests retrieval quality against known query/expected-source pairs.
 *
 * Usage:
 *   MARTOL_URL=https://martol.plitix.com MARTOL_API_KEY=mk_xxx npx tsx scripts/rag-eval.ts
 */

const MARTOL_URL = process.env.MARTOL_URL || 'http://localhost:5190';
const API_KEY = process.env.MARTOL_API_KEY || '';
const ORG_ID = process.env.MARTOL_ORG_ID || '';

interface TestCase {
	query: string;
	expectedFiles: string[]; // At least one of these should appear in results
	description: string;
}

const TEST_CORPUS: TestCase[] = [
	{
		query: 'apa fatwa pasal zakat fitrah?',
		expectedFiles: ['028.pdf', '191.pdf', '109.pdf', '094.pdf', '088.pdf'],
		description: 'Zakat fitrah rulings across multiple years',
	},
	{
		query: 'ada ke fatwa pasal black metal?',
		expectedFiles: ['198.pdf'],
		description: 'Black Metal subculture ruling in multi-topic doc',
	},
	{
		query: 'fatwa berkenaan autopsi maya',
		expectedFiles: ['198.pdf'],
		description: 'Virtual autopsy ruling',
	},
	{
		query: 'hukum pelaburan ASN ASB',
		expectedFiles: [], // Fill in when known
		description: 'ASN/ASB investment ruling',
	},
	{
		query: 'senaraikan ajaran sesat yang dikenalpasti',
		expectedFiles: ['198.pdf'],
		description: 'List of deviant teachings',
	},
	{
		query: 'hukum wakaf',
		expectedFiles: ['028.pdf'],
		description: 'Wakaf (endowment) ruling',
	},
	{
		query: 'fatwa mengenai nisab zakat wang',
		expectedFiles: ['014.pdf'],
		description: 'Zakat nisab on money',
	},
	{
		query: 'hukum melantik wanita sebagai hakim syarie',
		expectedFiles: ['198.pdf'],
		description: 'Female judge appointment',
	},
	{
		query: 'fatwa zakat penggajian',
		expectedFiles: ['176.pdf'],
		description: 'Salary zakat ruling',
	},
	{
		query: 'hukum air musoffa',
		expectedFiles: ['198.pdf'],
		description: 'Musoffa water ruling',
	},
];

interface SearchResult {
	content: string;
	filename: string;
	chunk_index: number;
	score: number;
	char_start: number | null;
	char_end: number | null;
	citation: string;
}

interface DocSearchResponse {
	ok: boolean;
	data?: {
		results: SearchResult[];
		total: number;
		citation_instructions: string;
	};
	error?: string;
	code?: string;
}

async function searchDocs(query: string, topK: number): Promise<SearchResult[]> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'x-api-key': API_KEY,
	};
	if (ORG_ID) {
		headers['x-org-id'] = ORG_ID;
	}

	const res = await fetch(`${MARTOL_URL}/mcp/v1`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			tool: 'doc_search',
			params: { query, top_k: topK },
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		console.error(`Search failed (${res.status}): ${text}`);
		return [];
	}

	const data = (await res.json()) as DocSearchResponse;
	return data?.data?.results ?? [];
}

function checkRecall(results: SearchResult[], expectedFiles: string[]): boolean {
	if (expectedFiles.length === 0) return true; // No expectation = skip
	const resultFiles = new Set(results.map((r) => r.filename));
	return expectedFiles.some((f) => resultFiles.has(f));
}

async function main() {
	if (!API_KEY) {
		console.error('MARTOL_API_KEY is required');
		process.exit(1);
	}

	console.log(`\nRAG Evaluation`);
	console.log(`URL: ${MARTOL_URL}`);
	if (ORG_ID) console.log(`Org: ${ORG_ID}`);
	console.log(`Test cases: ${TEST_CORPUS.length}\n`);

	let pass5 = 0,
		pass10 = 0,
		total = 0;

	console.log(
		'Query'.padEnd(45),
		'R@5'.padEnd(6),
		'R@10'.padEnd(6),
		'Top file'.padEnd(15),
		'Score'.padEnd(8),
		'Status'
	);
	console.log('-'.repeat(100));

	for (const tc of TEST_CORPUS) {
		if (tc.expectedFiles.length === 0) {
			console.log(
				tc.query.slice(0, 43).padEnd(45),
				'-'.padEnd(6),
				'-'.padEnd(6),
				'-'.padEnd(15),
				'-'.padEnd(8),
				'SKIP (no expected)'
			);
			continue;
		}

		total++;
		const results10 = await searchDocs(tc.query, 10);
		const results5 = results10.slice(0, 5);

		const hit5 = checkRecall(results5, tc.expectedFiles);
		const hit10 = checkRecall(results10, tc.expectedFiles);

		if (hit5) pass5++;
		if (hit10) pass10++;

		const topFile = results10[0]?.filename ?? 'none';
		const topScore = results10[0]?.score?.toFixed(4) ?? '-';
		const status = hit5 ? 'PASS' : hit10 ? 'PASS@10' : 'MISS';

		console.log(
			tc.query.slice(0, 43).padEnd(45),
			(hit5 ? 'Y' : 'N').padEnd(6),
			(hit10 ? 'Y' : 'N').padEnd(6),
			topFile.padEnd(15),
			topScore.padEnd(8),
			status
		);

		// Brief pause to avoid rate limiting
		await new Promise((r) => setTimeout(r, 500));
	}

	console.log('\n--- Summary ---\n');
	console.log(`Recall@5:  ${pass5}/${total} (${total > 0 ? Math.round((pass5 / total) * 100) : 0}%)`);
	console.log(`Recall@10: ${pass10}/${total} (${total > 0 ? Math.round((pass10 / total) * 100) : 0}%)`);

	if (pass5 < total) {
		console.log('\nMissed queries (not in top 5):');
		for (const tc of TEST_CORPUS) {
			if (tc.expectedFiles.length === 0) continue;
			const results = await searchDocs(tc.query, 10);
			const hit5 = checkRecall(results.slice(0, 5), tc.expectedFiles);
			if (!hit5) {
				const hit10 = checkRecall(results, tc.expectedFiles);
				console.log(`  "${tc.query}" [${hit10 ? 'in top 10' : 'MISSING'}]`);
				console.log(`    Expected: ${tc.expectedFiles.join(', ')}`);
				console.log(
					`    Got: ${results.map((r) => `${r.filename}(${r.score.toFixed(3)})`).join(', ') || '(empty)'}`
				);
			}
			await new Promise((r) => setTimeout(r, 300));
		}
	}
}

main().catch(console.error);
