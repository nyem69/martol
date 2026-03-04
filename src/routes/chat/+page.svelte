<script lang="ts">
	import ChatView from '$lib/components/chat/ChatView.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Chat — Martol</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#key `${data.roomId}:${data.roomName}`}
	<ChatView {data} />
{/key}
