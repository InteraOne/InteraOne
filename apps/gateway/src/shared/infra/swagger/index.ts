import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { Application } from "express";
import { resolve } from "node:path";
import config from "@shared/infra/config";
import { supplementalPaths } from "./supplemental-paths";

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    paths: supplementalPaths(),
    info: {
      title: "Interaone API Documentation",
      version: "1.0.0",
      description: "API specifications for InteraOne gateway services",
    },
    servers: [
      {
        url: `http://localhost:${config.app.port}/api/v1`,
        description: "Local development gateway",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: [
    resolve(__dirname, "../../../modules/**/*.routes.{ts,js}"),
    resolve(__dirname, "../../../modules/**/*.controller.{ts,js}"),
    resolve(__dirname, "../../../shared/**/*.{ts,js}"),
  ],
};

const swaggerSpec = swaggerJSDoc(options);

export const setupSwagger = (app: Application) => {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
};
