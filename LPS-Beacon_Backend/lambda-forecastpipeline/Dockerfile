# Lambda container image for lambda-forecastpipeline (Python 3.12, x86_64).
# A container image is used because the matching needs scipy + scikit-learn on top of
# pandas, which together exceed the 250 MB limit for zip packages with layers.
FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY lambda_function.py matching_script.py matching_python_script.py ${LAMBDA_TASK_ROOT}/
COPY pipeline ${LAMBDA_TASK_ROOT}/pipeline

CMD ["lambda_function.lambda_handler"]
