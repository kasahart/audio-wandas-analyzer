import { createStaticHost } from './staticHost';

createStaticHost({ window, document, Worker, fetch, URL, setTimeout });
