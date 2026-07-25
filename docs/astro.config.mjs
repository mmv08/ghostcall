import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const site = "https://ghostcall.volga.sh";
const socialImage = new URL("/og.png", site).href;
const socialImageAlt =
	"ghostcall: Batch contract reads in one call without deploying Multicall.";

export default defineConfig({
	site,
	integrations: [
		starlight({
			title: "ghostcall",
			description:
				"Batch EVM contract reads without deploying a Multicall contract.",
			head: [
				{
					tag: "meta",
					attrs: { property: "og:image", content: socialImage },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:secure_url", content: socialImage },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:type", content: "image/png" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:width", content: "1200" },
				},
				{
					tag: "meta",
					attrs: { property: "og:image:height", content: "630" },
				},
				{
					tag: "meta",
					attrs: {
						property: "og:image:alt",
						content: socialImageAlt,
					},
				},
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
				},
				{
					tag: "meta",
					attrs: { name: "twitter:image", content: socialImage },
				},
				{
					tag: "meta",
					attrs: {
						name: "twitter:image:alt",
						content: socialImageAlt,
					},
				},
			],
			customCss: ["./src/styles/volga.css"],
			editLink: {
				baseUrl: "https://github.com/volga-sh/ghostcall/edit/main/docs/",
			},
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/volga-sh/ghostcall",
				},
			],
			sidebar: [
				{
					label: "Guides",
					items: [
						{ label: "Getting Started", slug: "getting-started" },
						{ label: "Recipes", slug: "examples" },
					],
				},
				{
					label: "API",
					items: [
						{ label: "Overview", slug: "api" },
						{
							label: "aggregateDecodedCalls",
							slug: "api/aggregate-decoded-calls",
						},
						{ label: "aggregateCalls", slug: "api/aggregate-calls" },
						{ label: "encodeCalls", slug: "api/encode-calls" },
						{ label: "decodeResults", slug: "api/decode-results" },
						{ label: "GhostcallSubcallError", slug: "api/subcall-error" },
						{ label: "Types", slug: "api/types" },
					],
				},
				{
					label: "How It Works",
					items: [
						{ label: "Protocol", slug: "protocol" },
						{ label: "Limits", slug: "limits" },
					],
				},
				{
					label: "Contribute",
					items: [{ label: "Development", slug: "development" }],
				},
			],
		}),
	],
});
