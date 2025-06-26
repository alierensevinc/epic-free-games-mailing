import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import fetch from "node-fetch";

admin.initializeApp();
const db = admin.firestore();

export const fetchGamesNow = functions.https.onRequest(async (req, res) => {
    try {
        const response = await fetch(
            "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
        );

        if (!response.ok) {
            throw new Error(`Epic Games API failed with status ${response.status}`);
        }

        const data = await response.json();
        const games = data?.data?.Catalog?.searchStore?.elements ?? [];

        const now = new Date();
        const gamesRef = db.collection("games");
        let savedCount = 0;

        for (const game of games) {
            const promo = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
            if (!promo) continue;

            const start = new Date(promo.startDate);
            const end = new Date(promo.endDate);

            if (now < start || now > end) continue;

            const gameId = `${game.title}-${game.effectiveDate}`;
            const existingDoc = await gamesRef.doc(gameId).get();
            if (existingDoc.exists) continue;

            const imageUrl = game.keyImages?.find((img: any) => img.type === "OfferImageWide")?.url
                ?? game.keyImages?.[0]?.url
                ?? null;

            const productSlug = game.productSlug;
            const pageSlug = game.offerMappings?.[0]?.pageSlug;

            let gameUrl = "";
            if (productSlug) {
                gameUrl = `https://store.epicgames.com/p/${productSlug}`;
            } else if (pageSlug) {
                gameUrl = `https://store.epicgames.com/p/${pageSlug}`;
            }

            const gameData = {
                id: game.id,
                title: game.title,
                description: game.description ?? "",
                imageUrl,
                url: gameUrl,
                startDate: promo.startDate,
                endDate: promo.endDate,
                originalPrice: game.price?.totalPrice?.originalPrice ?? null,
                discountPrice: game.price?.totalPrice?.discountPrice ?? null,
                currency: game.price?.totalPrice?.currencyCode ?? "USD",
            };

            await gamesRef.doc(gameId).set(gameData);
            savedCount++;
        }

        res.status(200).send(`${savedCount} free games fetched and stored.`);
    } catch (err) {
        console.error("Error fetching games:", err);
        res.status(500).send("Something went wrong.");
    }
});