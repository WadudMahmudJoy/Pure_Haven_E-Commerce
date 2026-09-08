import { defineMediaStorageContract } from "./helpers/mediaStorageContract";
import { InMemoryMediaStorage } from "../lib/media/storage/inMemoryMediaStorage";

defineMediaStorageContract("InMemoryMediaStorage", () => new InMemoryMediaStorage());
