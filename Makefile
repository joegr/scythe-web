.PHONY: install web build test

# The web app. A team's server builds it into its own image and serves it.
install:
	cd frontend && npm install

web:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test:
	cd frontend && ./node_modules/.bin/tsc -b && ./node_modules/.bin/eslint src
